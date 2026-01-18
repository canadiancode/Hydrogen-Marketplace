# Order Line Items Implementation Guide

## Current Status ✅

### What's Already Working

1. **Webhook Handler** (`app/routes/webhooks.shopify.orders.create.jsx`)
   - ✅ Creates `order_line_items` records for each product in an order
   - ✅ Links line items to `orders`, `listings`, and `creators` via foreign keys
   - ✅ Tracks Shopify product/variant IDs for reference
   - ✅ Stores pricing information (unit price, line total, subtotal)
   - ✅ Handles multiple creators per order correctly

2. **Database Schema** (`order_line_items` table)
   - ✅ All required columns are present:
     - `order_id` (FK to orders)
     - `listing_id` (FK to listings)
     - `creator_id` (FK to creators)
     - `shopify_line_item_id`, `shopify_product_id`, `shopify_variant_id`
     - `quantity`, `unit_price_cents`, `line_total_cents`, `line_subtotal_cents`
     - `product_title`, `variant_title`
     - `created_at`

### What Was Just Added

3. **Order Query Functions** (`app/lib/orders.js`)
   - ✅ `fetchCreatorOrderLineItems()` - Query line items by creator
   - ✅ `fetchCreatorOrders()` - Get orders containing creator's products
   - ✅ `calculateCreatorSales()` - Calculate sales statistics
   - ✅ `calculateCreatorPayouts()` - Calculate payout amounts with platform fees
   - ✅ `fetchAdminOrderLineItems()` - Admin view of all line items
   - ✅ `fetchAdminSalesSummary()` - Platform-wide sales aggregation

## Next Steps 🚀

### 1. Update Dashboard Statistics (Recommended)

Update `fetchCreatorDashboardStats()` in `app/lib/supabase.js` to use `order_line_items` for more accurate sales tracking:

```javascript
// Instead of calculating from payouts, calculate from order_line_items
import {calculateCreatorSales, calculateCreatorPayouts} from './orders';

// In fetchCreatorDashboardStats:
const sales = await calculateCreatorSales(creatorId, supabaseUrl, anonKey, accessToken);
const payouts = await calculateCreatorPayouts(creatorId, supabaseUrl, anonKey, accessToken);

return {
  totalListings,
  activeListings,
  pendingApproval,
  totalEarnings: payouts.netAmountDollars, // More accurate than payouts table
  totalSales: sales.totalSalesDollars,
  totalItemsSold: sales.totalItemsSold,
  totalOrders: sales.totalOrders,
};
```

### 2. Create Orders/Sales Pages

Create new routes to display orders and sales:

**`app/routes/creator.orders.jsx`**
- Display list of orders containing creator's products
- Use `fetchCreatorOrders()` from `app/lib/orders.js`
- Show order details, line items, customer info

**`app/routes/creator.sales.jsx`**
- Display sales analytics and statistics
- Use `calculateCreatorSales()` and `calculateCreatorPayouts()`
- Show charts/graphs for sales over time
- Display payout calculations

### 3. Add Database Indexes (Performance)

Add indexes to improve query performance:

```sql
-- Index for querying by creator
CREATE INDEX IF NOT EXISTS idx_order_line_items_creator_id 
ON order_line_items(creator_id, created_at DESC);

-- Index for querying by order
CREATE INDEX IF NOT EXISTS idx_order_line_items_order_id 
ON order_line_items(order_id);

-- Index for querying by listing
CREATE INDEX IF NOT EXISTS idx_order_line_items_listing_id 
ON order_line_items(listing_id);

-- Composite index for date range queries
CREATE INDEX IF NOT EXISTS idx_order_line_items_creator_date 
ON order_line_items(creator_id, created_at);
```

### 4. Add RLS Policies (Security)

Ensure Row Level Security policies are configured in Supabase:

```sql
-- Allow creators to view their own order line items
CREATE POLICY "Creators can view their own order line items"
ON order_line_items
FOR SELECT
USING (
  creator_id IN (
    SELECT id FROM creators 
    WHERE email = auth.email()
  )
);

-- Service role can insert (for webhook)
-- Service role can view all (for admin)
```

### 5. Create Payout Records (Optional Enhancement)

When an order is created, you could automatically create payout records:

```javascript
// In webhooks.shopify.orders.create.jsx, after creating order_line_items:

// Calculate payout for each creator in this order
const creatorsInOrder = [...new Set(orderLineItems.map(item => item.creator_id))];

for (const creatorId of creatorsInOrder) {
  const creatorLineItems = orderLineItems.filter(item => item.creator_id === creatorId);
  const grossAmountCents = creatorLineItems.reduce((sum, item) => sum + item.line_total_cents, 0);
  const platformFeePercent = 10; // Or fetch from config
  const platformFeeCents = Math.round(grossAmountCents * (platformFeePercent / 100));
  const netAmountCents = grossAmountCents - platformFeeCents;

  // Create payout record
  await supabase.from('payouts').insert({
    creator_id: creatorId,
    listing_id: null, // Or link to primary listing
    gross_amount_cents: grossAmountCents,
    platform_fee_cents: platformFeeCents,
    net_amount_cents: netAmountCents,
    payout_status: 'pending',
  });
}
```

### 6. Handle Edge Cases

Consider these scenarios:

1. **Orders with non-marketplace products**: Currently, line items without matching listings aren't tracked. Decide if this is desired behavior.

2. **Refunds/Cancellations**: Add logic to handle order cancellations and refunds:
   - Mark line items as refunded
   - Update payout calculations
   - Update listing status back to 'live' if needed

3. **Partial Refunds**: Track which specific line items were refunded

4. **Order Updates**: Handle `orders/updated` webhook to sync order status changes

## Usage Examples

### Query Orders by Creator

```javascript
import {fetchCreatorOrders} from '~/lib/orders';

const orders = await fetchCreatorOrders(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-12-31T23:59:59Z',
    limit: 50,
  }
);
```

### Calculate Sales Statistics

```javascript
import {calculateCreatorSales} from '~/lib/orders';

const sales = await calculateCreatorSales(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-12-31T23:59:59Z',
  }
);

console.log(`Total Sales: $${sales.totalSalesDollars}`);
console.log(`Items Sold: ${sales.totalItemsSold}`);
console.log(`Total Orders: ${sales.totalOrders}`);
```

### Calculate Payouts

```javascript
import {calculateCreatorPayouts} from '~/lib/orders';

const payouts = await calculateCreatorPayouts(
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  {
    platformFeePercent: 10,
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-12-31T23:59:59Z',
  }
);

console.log(`Gross: $${payouts.grossAmountDollars}`);
console.log(`Platform Fee: $${payouts.platformFeeDollars}`);
console.log(`Net Payout: $${payouts.netAmountDollars}`);
```

## Testing Checklist

- [ ] Test webhook with single-product order
- [ ] Test webhook with multi-product order (same creator)
- [ ] Test webhook with multi-product order (different creators)
- [ ] Test webhook idempotency (duplicate order)
- [ ] Test querying orders by creator
- [ ] Test sales calculations
- [ ] Test payout calculations
- [ ] Test date range filters
- [ ] Test RLS policies (creators can only see their own)
- [ ] Test admin functions (service role)

## Security Considerations

1. ✅ UUID validation prevents injection attacks
2. ✅ Parameterized queries (Supabase handles this)
3. ⚠️ RLS policies should be configured in Supabase
4. ⚠️ Rate limiting should be added for query endpoints
5. ⚠️ Input validation for date ranges and limits

## Performance Considerations

1. ⚠️ Add database indexes (see step 3 above)
2. ⚠️ Consider pagination for large result sets
3. ⚠️ Cache frequently accessed statistics
4. ⚠️ Use database views for complex aggregations if needed

## Summary

**Current State**: ✅ Order line items are being created correctly by the webhook handler.

**Next Step**: Use the new `app/lib/orders.js` functions to:
1. Display orders and sales in the creator dashboard
2. Create dedicated orders/sales pages
3. Update dashboard statistics to use order_line_items

The foundation is solid - now it's time to build the UI and analytics features on top of it!
