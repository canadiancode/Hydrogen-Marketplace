/**
 * Order Management Utilities for WornVault
 * 
 * Provides functions to query orders by creator, calculate sales, and manage payouts.
 * Works with the order_line_items table to track individual product sales per creator.
 * 
 * SECURITY NOTES:
 * - All functions validate UUIDs to prevent injection attacks
 * - Uses parameterized queries (Supabase handles this)
 * - RLS policies should be configured in Supabase for user-scoped queries
 */

import {createServerSupabaseClient, createUserSupabaseClient} from './supabase';

/**
 * SECURITY: Validates UUID format to prevent injection attacks
 * @param {string} uuid - UUID string to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Fetches all order line items for a specific creator
 * Used to track which products a creator has sold
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @param {object} options - Optional filters
 * @param {string} options.orderId - Filter by specific order ID
 * @param {string} options.listingId - Filter by specific listing ID
 * @param {string} options.startDate - Filter orders from this date (ISO string)
 * @param {string} options.endDate - Filter orders until this date (ISO string)
 * @param {number} options.limit - Maximum number of items to return
 * @returns {Promise<Array>} Array of order line items with order and listing details
 */
export async function fetchCreatorOrderLineItems(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  options = {}
) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return [];
  }

  // SECURITY: Validate UUID
  if (!isValidUUID(creatorId)) {
    console.error('Invalid creator ID format');
    return [];
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

  // Build query with joins to get order and listing details
  let query = supabase
    .from('order_line_items')
    .select(`
      *,
      order:orders(
        id,
        shopify_order_id,
        order_number,
        order_name,
        customer_email,
        customer_name,
        total_price_cents,
        currency,
        financial_status,
        fulfillment_status,
        processed_at,
        created_at
      ),
      listing:listings(
        id,
        title,
        category,
        price_cents,
        status
      )
    `)
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false});

  // Apply filters
  if (options.orderId && isValidUUID(options.orderId)) {
    query = query.eq('order_id', options.orderId);
  }

  if (options.listingId && isValidUUID(options.listingId)) {
    query = query.eq('listing_id', options.listingId);
  }

  if (options.startDate) {
    query = query.gte('created_at', options.startDate);
  }

  if (options.endDate) {
    query = query.lte('created_at', options.endDate);
  }

  // Apply limit (with security check)
  const limit = options.limit && typeof options.limit === 'number' && options.limit > 0 && options.limit <= 1000
    ? options.limit
    : 100;
  query = query.limit(limit);

  const {data, error} = await query;

  if (error) {
    console.error('Error fetching creator order line items:', error);
    return [];
  }

  return data || [];
}

/**
 * Fetches all orders that contain items from a specific creator
 * Returns unique orders (not line items) that have at least one item from this creator
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @param {object} options - Optional filters
 * @param {string} options.startDate - Filter orders from this date (ISO string)
 * @param {string} options.endDate - Filter orders until this date (ISO string)
 * @param {number} options.limit - Maximum number of orders to return
 * @returns {Promise<Array>} Array of orders with line items for this creator
 */
export async function fetchCreatorOrders(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  options = {}
) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return [];
  }

  // SECURITY: Validate UUID
  if (!isValidUUID(creatorId)) {
    console.error('Invalid creator ID format');
    return [];
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

  // First, get all order IDs that have items from this creator
  let orderLineItemsQuery = supabase
    .from('order_line_items')
    .select('order_id, created_at')
    .eq('creator_id', creatorId);

  if (options.startDate) {
    orderLineItemsQuery = orderLineItemsQuery.gte('created_at', options.startDate);
  }

  if (options.endDate) {
    orderLineItemsQuery = orderLineItemsQuery.lte('created_at', options.endDate);
  }

  const {data: lineItems, error: lineItemsError} = await orderLineItemsQuery;

  if (lineItemsError || !lineItems || lineItems.length === 0) {
    return [];
  }

  // Get unique order IDs
  const orderIds = [...new Set(lineItems.map(item => item.order_id))];

  // Fetch orders with their line items for this creator
  const limit = options.limit && typeof options.limit === 'number' && options.limit > 0 && options.limit <= 500
    ? options.limit
    : 100;

  const {data: orders, error: ordersError} = await supabase
    .from('orders')
    .select(`
      *,
      line_items:order_line_items!inner(
        *,
        listing:listings(
          id,
          title,
          category,
          price_cents,
          status
        )
      )
    `)
    .in('id', orderIds)
    .eq('line_items.creator_id', creatorId) // Only get line items for this creator
    .order('created_at', {ascending: false})
    .limit(limit);

  if (ordersError) {
    console.error('Error fetching creator orders:', ordersError);
    return [];
  }

  // Filter line items to only include those from this creator
  return (orders || []).map(order => ({
    ...order,
    line_items: (order.line_items || []).filter(item => item.creator_id === creatorId),
  }));
}

/**
 * Calculates sales statistics for a creator
 * Returns total sales, item count, and breakdown by time period
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @param {object} options - Optional filters
 * @param {string} options.startDate - Calculate sales from this date (ISO string)
 * @param {string} options.endDate - Calculate sales until this date (ISO string)
 * @returns {Promise<object>} Sales statistics object
 */
export async function calculateCreatorSales(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  options = {}
) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      averageOrderValueCents: 0,
      averageOrderValueDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  // SECURITY: Validate UUID
  if (!isValidUUID(creatorId)) {
    console.error('Invalid creator ID format');
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      averageOrderValueCents: 0,
      averageOrderValueDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

  // Build query for order line items
  let query = supabase
    .from('order_line_items')
    .select('line_total_cents, quantity, order_id')
    .eq('creator_id', creatorId);

  if (options.startDate) {
    query = query.gte('created_at', options.startDate);
  }

  if (options.endDate) {
    query = query.lte('created_at', options.endDate);
  }

  const {data: lineItems, error} = await query;

  if (error) {
    console.error('Error calculating creator sales:', error);
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      averageOrderValueCents: 0,
      averageOrderValueDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  if (!lineItems || lineItems.length === 0) {
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      averageOrderValueCents: 0,
      averageOrderValueDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  // Calculate totals
  const totalSalesCents = lineItems.reduce((sum, item) => sum + (item.line_total_cents || 0), 0);
  const totalItemsSold = lineItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const uniqueOrderIds = new Set(lineItems.map(item => item.order_id));
  const totalOrders = uniqueOrderIds.size;

  const totalSalesDollars = totalSalesCents / 100;
  const averageOrderValueCents = totalOrders > 0 ? Math.round(totalSalesCents / totalOrders) : 0;
  const averageOrderValueDollars = averageOrderValueCents / 100;

  return {
    totalSalesCents,
    totalSalesDollars: totalSalesDollars.toFixed(2),
    totalItemsSold,
    totalOrders,
    averageOrderValueCents,
    averageOrderValueDollars: averageOrderValueDollars.toFixed(2),
    period: {
      startDate: options.startDate || null,
      endDate: options.endDate || null,
    },
  };
}

/**
 * Calculates payout amounts for a creator based on their sales
 * Takes into account platform fees and calculates net payout
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @param {object} options - Optional parameters
 * @param {number} options.platformFeePercent - Platform fee percentage (default: 10%)
 * @param {string} options.startDate - Calculate payouts from this date (ISO string)
 * @param {string} options.endDate - Calculate payouts until this date (ISO string)
 * @returns {Promise<object>} Payout calculation object
 */
export async function calculateCreatorPayouts(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  options = {}
) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return {
      grossAmountCents: 0,
      grossAmountDollars: 0,
      platformFeeCents: 0,
      platformFeeDollars: 0,
      netAmountCents: 0,
      netAmountDollars: 0,
      platformFeePercent: options.platformFeePercent || 10,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  // SECURITY: Validate UUID
  if (!isValidUUID(creatorId)) {
    console.error('Invalid creator ID format');
    return {
      grossAmountCents: 0,
      grossAmountDollars: 0,
      platformFeeCents: 0,
      platformFeeDollars: 0,
      netAmountCents: 0,
      netAmountDollars: 0,
      platformFeePercent: options.platformFeePercent || 10,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  // Validate and set platform fee (default 10%)
  const platformFeePercent = options.platformFeePercent && typeof options.platformFeePercent === 'number' && options.platformFeePercent >= 0 && options.platformFeePercent <= 100
    ? options.platformFeePercent
    : 10;

  // Get sales data
  const sales = await calculateCreatorSales(creatorId, supabaseUrl, anonKey, accessToken, {
    startDate: options.startDate,
    endDate: options.endDate,
  });

  // Calculate payout amounts
  const grossAmountCents = sales.totalSalesCents;
  const platformFeeCents = Math.round(grossAmountCents * (platformFeePercent / 100));
  const netAmountCents = grossAmountCents - platformFeeCents;

  return {
    grossAmountCents,
    grossAmountDollars: (grossAmountCents / 100).toFixed(2),
    platformFeeCents,
    platformFeeDollars: (platformFeeCents / 100).toFixed(2),
    netAmountCents,
    netAmountDollars: (netAmountCents / 100).toFixed(2),
    platformFeePercent,
    totalItemsSold: sales.totalItemsSold,
    totalOrders: sales.totalOrders,
    period: {
      startDate: options.startDate || null,
      endDate: options.endDate || null,
    },
  };
}

/**
 * Fetches order line items for admin review (all creators)
 * Uses service role key to bypass RLS
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key
 * @param {object} options - Optional filters
 * @param {string} options.creatorId - Filter by specific creator ID
 * @param {string} options.orderId - Filter by specific order ID
 * @param {string} options.startDate - Filter from this date (ISO string)
 * @param {string} options.endDate - Filter until this date (ISO string)
 * @param {number} options.limit - Maximum number of items to return
 * @returns {Promise<Array>} Array of order line items with order, listing, and creator details
 */
export async function fetchAdminOrderLineItems(
  supabaseUrl,
  serviceRoleKey,
  options = {}
) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);

  // Build query with joins
  let query = supabase
    .from('order_line_items')
    .select(`
      *,
      order:orders(
        id,
        shopify_order_id,
        order_number,
        order_name,
        customer_email,
        customer_name,
        total_price_cents,
        currency,
        financial_status,
        fulfillment_status,
        processed_at,
        created_at
      ),
      listing:listings(
        id,
        title,
        category,
        price_cents,
        status
      ),
      creator:creators(
        id,
        email,
        display_name,
        handle
      )
    `)
    .order('created_at', {ascending: false});

  // Apply filters
  if (options.creatorId && isValidUUID(options.creatorId)) {
    query = query.eq('creator_id', options.creatorId);
  }

  if (options.orderId && isValidUUID(options.orderId)) {
    query = query.eq('order_id', options.orderId);
  }

  if (options.startDate) {
    query = query.gte('created_at', options.startDate);
  }

  if (options.endDate) {
    query = query.lte('created_at', options.endDate);
  }

  // Apply limit (with security check)
  const limit = options.limit && typeof options.limit === 'number' && options.limit > 0 && options.limit <= 1000
    ? options.limit
    : 100;
  query = query.limit(limit);

  const {data, error} = await query;

  if (error) {
    console.error('Error fetching admin order line items:', error);
    return [];
  }

  return data || [];
}

/**
 * Gets sales summary for all creators (admin view)
 * Aggregates sales data across all creators
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key
 * @param {object} options - Optional filters
 * @param {string} options.startDate - Calculate from this date (ISO string)
 * @param {string} options.endDate - Calculate until this date (ISO string)
 * @returns {Promise<object>} Aggregated sales summary
 */
export async function fetchAdminSalesSummary(
  supabaseUrl,
  serviceRoleKey,
  options = {}
) {
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      totalCreators: 0,
      platformFeeCents: 0,
      platformFeeDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);

  // Build query
  let query = supabase
    .from('order_line_items')
    .select('line_total_cents, quantity, order_id, creator_id');

  if (options.startDate) {
    query = query.gte('created_at', options.startDate);
  }

  if (options.endDate) {
    query = query.lte('created_at', options.endDate);
  }

  const {data: lineItems, error} = await query;

  if (error) {
    console.error('Error fetching admin sales summary:', error);
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      totalCreators: 0,
      platformFeeCents: 0,
      platformFeeDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  if (!lineItems || lineItems.length === 0) {
    return {
      totalSalesCents: 0,
      totalSalesDollars: 0,
      totalItemsSold: 0,
      totalOrders: 0,
      totalCreators: 0,
      platformFeeCents: 0,
      platformFeeDollars: 0,
      period: {
        startDate: options.startDate || null,
        endDate: options.endDate || null,
      },
    };
  }

  // Calculate aggregates
  const totalSalesCents = lineItems.reduce((sum, item) => sum + (item.line_total_cents || 0), 0);
  const totalItemsSold = lineItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const uniqueOrderIds = new Set(lineItems.map(item => item.order_id));
  const uniqueCreatorIds = new Set(lineItems.map(item => item.creator_id).filter(Boolean));

  // Calculate platform fees (assuming 10% default, can be made configurable)
  const platformFeePercent = 10;
  const platformFeeCents = Math.round(totalSalesCents * (platformFeePercent / 100));

  return {
    totalSalesCents,
    totalSalesDollars: (totalSalesCents / 100).toFixed(2),
    totalItemsSold,
    totalOrders: uniqueOrderIds.size,
    totalCreators: uniqueCreatorIds.size,
    platformFeeCents,
    platformFeeDollars: (platformFeeCents / 100).toFixed(2),
    period: {
      startDate: options.startDate || null,
      endDate: options.endDate || null,
    },
  };
}
