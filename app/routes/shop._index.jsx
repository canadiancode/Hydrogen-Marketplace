import {useLoaderData} from 'react-router';

export const meta = () => {
  return [{title: 'WornVault | Shop'}];
};

export async function loader({context}) {
  // Fetch products from Shopify
  const {storefront} = context;
  const {products} = await storefront.query(SHOP_QUERY);
  
  return {
    products: products.nodes,
  };
}

export default function Shop() {
  const {products} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Shop</h1>
          <p className="text-lg text-gray-600">
            Browse available inventory from verified creators. Discover unique items with authentic stories.
          </p>
        </div>
        
        {/* Product grid will go here */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* Products will be rendered here */}
        </div>
      </div>
    </div>
  );
}

const SHOP_QUERY = `#graphql
  query Shop {
    products(first: 20) {
      nodes {
        id
        title
        handle
        # ... other fields
      }
    }
  }
`;