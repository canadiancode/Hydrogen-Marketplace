/**
 * Shopify Orders/Create Webhook Handler
 * 
 * Handles Shopify webhook notifications when a new order is created.
 * Updates Supabase database with order information and marks listings as sold.
 * 
 * LISTING MATCHING:
 * - Matches listings by product_id (lineItem.product_id) which equals shopify_product_id in listings table
 * - Only updates listings with status 'live' to prevent double-processing
 * - Sets listing status to 'sold' and sold_at timestamp when order is created
 * 
 * SECURITY FEATURES:
 * - HMAC SHA-256 signature verification
 * - Request size limits
 * - Input validation (numeric product_id validation)
 * - Idempotency checks (duplicate order detection)
 * - Race condition protection (only updates 'live' listings)
 * - Error handling with detailed logging
 * 
 * Endpoint: POST /webhooks/shopify/orders/create
 */

import {data} from 'react-router';
import {
  verifyShopifyWebhook,
  parseWebhookPayload,
  validateWebhookEnv,
  validateOrderData,
} from '~/lib/webhooks/shopify';
import {createServerSupabaseClient} from '~/lib/supabase';

/**
 * Only allow POST requests
 */
export async function loader() {
  return data({error: 'Method not allowed'}, {status: 405});
}

/**
 * Handle Shopify orders/create webhook
 * 
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  // Log incoming webhook request details
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  
  console.error('[WEBHOOK] Received Shopify webhook request:', {
    method: request.method,
    url: url.pathname + url.search,
    headers: {
      'content-type': headers['content-type'],
      'content-length': headers['content-length'],
      'x-shopify-hmac-sha256': headers['x-shopify-hmac-sha256'] ? 'present' : 'missing',
      'x-shopify-shop-domain': headers['x-shopify-shop-domain'],
      'x-shopify-topic': headers['x-shopify-topic'],
      'x-shopify-webhook-id': headers['x-shopify-webhook-id'],
      'user-agent': headers['user-agent'],
    },
    timestamp: new Date().toISOString(),
  });

  // Only allow POST
  if (request.method !== 'POST') {
    console.error('[WEBHOOK] Invalid method:', request.method);
    return data({error: 'Method not allowed'}, {status: 405});
  }

  // Validate environment variables
  if (!validateWebhookEnv(context.env)) {
    console.error('[WEBHOOK] Missing required webhook environment variables');
    return data({error: 'Server configuration error'}, {status: 500});
  }

  const {env} = context;
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET;

  // Log webhook secret status (without exposing the actual secret)
  console.error('[WEBHOOK] Webhook secret configured:', !!webhookSecret);

  // Verify webhook signature and get body
  const verification = await verifyShopifyWebhook(request, webhookSecret);
  if (!verification.valid) {
    console.error('[WEBHOOK] Webhook verification failed:', verification.error);
    return data({error: 'Unauthorized'}, {status: 401});
  }

  // Log successful verification and payload info
  console.error('[WEBHOOK] Webhook verified successfully. Payload size:', verification.body?.length || 0, 'bytes');

  try {
    // Log raw body before parsing (first 500 chars to avoid huge logs)
    const bodyPreview = verification.body?.substring(0, 500) || '';
    console.error('[WEBHOOK] Raw payload preview:', bodyPreview + (verification.body?.length > 500 ? '...' : ''));

    // Parse webhook payload
    const orderData = parseWebhookPayload(verification.body);

    // Log parsed order data summary
    console.error('[WEBHOOK] Parsed order data:', {
      orderId: orderData.id,
      orderNumber: orderData.order_number || orderData.number,
      orderName: orderData.name,
      email: orderData.email,
      totalPrice: orderData.total_price,
      currency: orderData.currency,
      lineItemsCount: Array.isArray(orderData.line_items) ? orderData.line_items.length : 0,
      financialStatus: orderData.financial_status,
      fulfillmentStatus: orderData.fulfillment_status,
    });

    // Validate order data structure
    const validation = validateOrderData(orderData);
    if (!validation.valid) {
      console.error('[WEBHOOK] Invalid order data:', validation.error);
      return data({error: validation.error}, {status: 400});
    }

    // Create Supabase client with service role key
    const supabase = createServerSupabaseClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Process order and update Supabase
    const result = await processOrder(orderData, supabase);

    if (result.success) {
      // Return 200 OK to Shopify
      console.error('[WEBHOOK] Order processed successfully:', orderData.id);
      return data({success: true, orderId: orderData.id}, {status: 200});
    } else {
      // Log error but return 200 to prevent retries
      // Implement retry queue for production
      console.error('[WEBHOOK] Error processing order:', result.error);
      return data({error: result.error?.message || 'Processing failed'}, {status: 200});
    }
  } catch (error) {
    console.error('[WEBHOOK] Unexpected error processing webhook:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
    // Return 200 to prevent Shopify from retrying
    return data({error: 'Internal server error'}, {status: 200});
  }
}

/**
 * Processes order data and updates Supabase
 * 
 * SECURITY: Validates all inputs, uses parameterized queries (Supabase handles this)
 * 
 * @param {object} orderData - Shopify order data
 * @param {object} supabase - Supabase client instance
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
async function processOrder(orderData, supabase) {
  try {
    const shopifyOrderId = String(orderData.id);
    const orderNumber = orderData.order_number || orderData.number;
    const orderName = orderData.name || `#${orderNumber || 'unknown'}`;

    // Validate order ID format (should be numeric string)
    if (!/^\d+$/.test(shopifyOrderId)) {
      return {success: false, error: new Error('Invalid order ID format')};
    }

    // Check if order already exists (idempotency check)
    const {data: existingOrder, error: checkError} = await supabase
      .from('orders')
      .select('id')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 = no rows found (expected), other errors are real issues
      console.error('Error checking existing order:', checkError);
      return {success: false, error: checkError};
    }

    if (existingOrder) {
      console.log(`Order ${shopifyOrderId} already processed, skipping`);
      return {success: true};
    }

    // Extract line items and find associated listings
    // Use product_id from Shopify webhook to match shopify_product_id in listings table
    const lineItems = Array.isArray(orderData.line_items) ? orderData.line_items : [];
    const listingUpdates = [];

    for (const lineItem of lineItems) {
      // Validate line item structure
      if (!lineItem || typeof lineItem !== 'object') continue;

      // Extract product_id from line item (matches shopify_product_id in listings table)
      const shopifyProductId = lineItem.product_id ? String(lineItem.product_id).trim() : null;
      
      // Validate product_id format (Shopify product IDs are numeric strings)
      if (shopifyProductId && /^\d+$/.test(shopifyProductId)) {
        // Find listing by Shopify product ID
        const {data: listing, error: listingError} = await supabase
          .from('listings')
          .select('id, status, creator_id')
          .eq('shopify_product_id', shopifyProductId)
          .eq('status', 'live')
          .maybeSingle();

        if (listing && !listingError) {
          const quantity = Math.max(1, Math.floor(parseFloat(lineItem.quantity) || 1));
          const price = Math.max(0, parseFloat(lineItem.price || '0'));
          
          if (isFinite(quantity) && isFinite(price)) {
            listingUpdates.push({
              listingId: listing.id,
              creatorId: listing.creator_id,
              quantity,
              price,
              shopifyProductId, // Store for matching back to Shopify line item
              shopifyLineItem: lineItem, // Store full line item for order_line_items creation
            });
            
            console.log(`[WEBHOOK] Found listing ${listing.id} for Shopify product ${shopifyProductId}`);
          }
        } else if (listingError) {
          console.error(`[WEBHOOK] Error finding listing for Shopify product ${shopifyProductId}:`, listingError);
        } else {
          console.log(`[WEBHOOK] No live listing found for Shopify product ${shopifyProductId} (may already be sold or not exist)`);
        }
      } else if (shopifyProductId) {
        // Log warning if product_id exists but isn't numeric
        console.warn(`[WEBHOOK] Invalid product_id format (expected numeric): ${shopifyProductId}`);
      }
    }

    // Validate and sanitize order data
    const totalPrice = Math.max(0, Math.round(parseFloat(orderData.total_price || '0') * 100));
    const subtotalPrice = Math.max(0, Math.round(parseFloat(orderData.subtotal_price || '0') * 100));
    const totalTax = Math.max(0, Math.round(parseFloat(orderData.total_tax || '0') * 100));
    const shippingPrice = orderData.total_shipping_price_set?.shop_money?.amount
      ? Math.max(0, Math.round(parseFloat(orderData.total_shipping_price_set.shop_money.amount) * 100))
      : 0;

    // Sanitize customer email
    let customerEmail = null;
    if (orderData.email && typeof orderData.email === 'string') {
      const email = orderData.email.trim().toLowerCase();
      // Basic email validation
      if (email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        customerEmail = email;
      }
    }

    // Sanitize customer name
    let customerName = null;
    if (orderData.customer?.first_name || orderData.customer?.last_name) {
      const firstName = (orderData.customer.first_name || '').trim().substring(0, 100);
      const lastName = (orderData.customer.last_name || '').trim().substring(0, 100);
      if (firstName || lastName) {
        customerName = [firstName, lastName].filter(Boolean).join(' ').substring(0, 200);
      }
    }

    // Create order record in Supabase
    // NOTE: You need to create an 'orders' table with these columns
    const orderRecord = {
      shopify_order_id: shopifyOrderId,
      order_number: orderNumber ? String(orderNumber).substring(0, 50) : null,
      order_name: orderName.substring(0, 100),
      customer_email: customerEmail,
      customer_name: customerName,
      total_price_cents: totalPrice,
      subtotal_price_cents: subtotalPrice,
      total_tax_cents: totalTax,
      total_shipping_cents: shippingPrice,
      currency: (orderData.currency || 'USD').substring(0, 3),
      financial_status: (orderData.financial_status || 'pending').substring(0, 50),
      fulfillment_status: orderData.fulfillment_status ? String(orderData.fulfillment_status).substring(0, 50) : null,
      processed_at: orderData.processed_at || new Date().toISOString(),
      created_at: orderData.created_at || new Date().toISOString(),
      // Store full order data as JSON (optional, but useful for debugging)
      order_data: orderData,
    };

    const {data: order, error: orderError} = await supabase
      .from('orders')
      .insert(orderRecord)
      .select()
      .single();

    if (orderError) {
      // Check if it's a duplicate key error (race condition)
      if (orderError.code === '23505') {
        console.log(`Order ${shopifyOrderId} was processed concurrently, skipping`);
        return {success: true};
      }
      console.error('Error creating order:', orderError);
      return {success: false, error: orderError};
    }

    // Create order line items for each listing found
    const orderLineItems = [];

    for (const update of listingUpdates) {
      const shopifyLineItem = update.shopifyLineItem;
      if (!shopifyLineItem) continue;

      const unitPriceCents = Math.round(update.price * 100);
      const lineTotalCents = Math.round(update.price * update.quantity * 100);
      
      // Calculate line subtotal (may differ from total if discounts apply)
      const lineSubtotalCents = shopifyLineItem.subtotal
        ? Math.round(parseFloat(shopifyLineItem.subtotal) * 100)
        : lineTotalCents;

      orderLineItems.push({
        order_id: order.id,
        listing_id: update.listingId,
        creator_id: update.creatorId,
        shopify_line_item_id: shopifyLineItem.id ? String(shopifyLineItem.id) : null,
        shopify_product_id: String(shopifyLineItem.product_id),
        shopify_variant_id: shopifyLineItem.variant_id ? String(shopifyLineItem.variant_id) : null,
        quantity: update.quantity,
        unit_price_cents: unitPriceCents,
        line_total_cents: lineTotalCents,
        line_subtotal_cents: lineSubtotalCents,
        product_title: shopifyLineItem.title || shopifyLineItem.name || null,
        variant_title: shopifyLineItem.variant_title || null,
      });
    }

    // Insert all order line items in a single transaction
    if (orderLineItems.length > 0) {
      const {data: insertedLineItems, error: lineItemsError} = await supabase
        .from('order_line_items')
        .insert(orderLineItems)
        .select('id, creator_id, listing_id');

      if (lineItemsError) {
        console.error('[WEBHOOK] Error creating order line items:', lineItemsError);
        // Log error but continue processing - order is already created
        // Consider whether to fail the entire transaction or continue
      } else {
        console.log(`[WEBHOOK] Created ${insertedLineItems?.length || 0} order line items`);
        
        // Log creator breakdown for debugging
        const creatorBreakdown = {};
        insertedLineItems?.forEach(item => {
          creatorBreakdown[item.creator_id] = (creatorBreakdown[item.creator_id] || 0) + 1;
        });
        console.log('[WEBHOOK] Order line items by creator:', creatorBreakdown);
      }
    } else {
      console.warn('[WEBHOOK] No order line items to create (no matching listings found)');
    }

    // Update listing statuses to 'sold' and set sold_at timestamp
    const soldAtTimestamp = new Date().toISOString();
    let updatedCount = 0;
    let failedCount = 0;

    for (const update of listingUpdates) {
      const updateData = {
        status: 'sold',
        sold_at: soldAtTimestamp,
      };
      
      // Only update if listing is still 'live' (safety check to prevent double-processing)
      const {data: updatedListing, error: updateError} = await supabase
        .from('listings')
        .update(updateData)
        .eq('id', update.listingId)
        .eq('status', 'live') // Only update if still live (prevents race conditions)
        .select('id, status')
        .single();

      if (updateError) {
        console.error(`[WEBHOOK] Error updating listing ${update.listingId}:`, updateError);
        failedCount++;
        // Continue processing other listings even if one fails
      } else if (updatedListing) {
        console.log(`[WEBHOOK] Successfully marked listing ${update.listingId} as sold`);
        updatedCount++;
      } else {
        // Listing was not updated (likely already sold or status changed)
        console.warn(`[WEBHOOK] Listing ${update.listingId} was not updated (may already be sold)`);
      }
    }

    if (listingUpdates.length > 0) {
      console.log(`[WEBHOOK] Listing update summary: ${updatedCount} updated, ${failedCount} failed, ${listingUpdates.length} total`);
    }

    return {success: true};
  } catch (error) {
    console.error('Error processing order:', error);
    return {success: false, error};
  }
}

/** @typedef {import('./+types/webhooks.shopify.orders.create').Route} Route */