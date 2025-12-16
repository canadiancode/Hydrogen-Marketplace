/**
 * Product Categories - Single Source of Truth
 * 
 * This file contains all product categories used throughout the application.
 * Update categories here to reflect changes across the entire app.
 */

// Category options organized by type
export const CATEGORIES = {
  clothing: [
    'Tops',
    'Bottoms',
    'Dresses & One-Pieces',
    'Skirts',
    'Outerwear',
    'Activewear',
    'Swimwear',
    'Intimates & Lingerie',
    'Sleepwear & Loungewear',
    'Accessories',
    'Shoes',
    'Jewelry'
  ],
  marketplace: [
    'Electronics',
    'Home & Garden',
    'Beauty & Personal Care',
    'Health & Wellness',
    'Sports & Outdoors',
    'Toys & Games',
    'Books & Media',
    'Automotive',
    'Pet Supplies',
    'Office Supplies',
    'Food & Beverages',
    'Other',
  ],
};

// Flatten categories for search and dropdowns
export const ALL_CATEGORIES = [
  ...CATEGORIES.clothing.map(cat => ({value: cat, type: 'clothing'})),
  ...CATEGORIES.marketplace.map(cat => ({value: cat, type: 'marketplace'})),
];

// Get all category values as a flat array (for validation)
export const VALID_CATEGORIES = ALL_CATEGORIES.map(cat => cat.value);

// Get categories by type
export function getCategoriesByType(type) {
  return CATEGORIES[type] || [];
}

// Check if a category is valid
export function isValidCategory(category) {
  return VALID_CATEGORIES.includes(category);
}

// Get category type for a given category value
export function getCategoryType(category) {
  const found = ALL_CATEGORIES.find(cat => cat.value === category);
  return found ? found.type : null;
}
