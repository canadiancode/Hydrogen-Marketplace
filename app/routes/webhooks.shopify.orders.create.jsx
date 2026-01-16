/**
 * Shopify Orders/Create Webhook Handler
 * 
 * Handles Shopify webhook notifications when a new order is created.
 * Updates Supabase database with order information and marks listings as sold.
 * 
 * SECURITY FEATURES:
 * - HMAC SHA-256 signature verification
 * - Request size limits
 * - Input validation
 * - Idempotency checks
 * - Error handling
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
  // Only allow POST
  if (request.method !== 'POST') {
    return data({error: 'Method not allowed'}, {status: 405});
  }

  // Validate environment variables
  if (!validateWebhookEnv(context.env)) {
    console.error('Missing required webhook environment variables');
    return data({error: 'Server configuration error'}, {status: 500});
  }

  const {env} = context;
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET;

  // Verify webhook signature and get body
  const verification = await verifyShopifyWebhook(request, webhookSecret);
  if (!verification.valid) {
    console.error('Webhook verification failed:', verification.error);
    return data({error: 'Unauthorized'}, {status: 401});
  }

  try {
    // Parse webhook payload
    const orderData = parseWebhookPayload(verification.body);

    // Validate order data structure
    const validation = validateOrderData(orderData);
    if (!validation.valid) {
      console.error('Invalid order data:', validation.error);
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
      return data({success: true, orderId: orderData.id}, {status: 200});
    } else {
      // Log error but return 200 to prevent retries
      // Implement retry queue for production
      console.error('Error processing order:', result.error);
      return data({error: result.error?.message || 'Processing failed'}, {status: 200});
    }
  } catch (error) {
    console.error('Unexpected error processing webhook:', error);
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
    // Note: You'll need to create an 'orders' table or use existing table
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
    const lineItems = Array.isArray(orderData.line_items) ? orderData.line_items : [];
    const listingUpdates = [];

    for (const lineItem of lineItems) {
      // Validate line item structure
      if (!lineItem || typeof lineItem !== 'object') continue;

      const shopifyProductId = lineItem.product_id ? String(lineItem.product_id) : null;
      
      // Only use product_id since variant_id column doesn't exist yet
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
            });
          }
        }
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

    // Update listing statuses to 'sold'
    for (const update of listingUpdates) {
      const updateData = {
        status: 'sold',
        sold_at: new Date().toISOString(), // Set sold_at timestamp
      };
      
      const {error: updateError} = await supabase
        .from('listings')
        .update(updateData)
        .eq('id', update.listingId);

      if (updateError) {
        console.error(`Error updating listing ${update.listingId}:`, updateError);
        // Continue processing other listings even if one fails
      }
    }

    return {success: true};
  } catch (error) {
    console.error('Error processing order:', error);
    return {success: false, error};
  }
}

/** @typedef {import('./+types/webhooks.shopify.orders.create').Route} Route */