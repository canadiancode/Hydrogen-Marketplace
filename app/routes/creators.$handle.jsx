import {useLoaderData} from 'react-router';

export const meta = ({data}) => {
  return [{title: `WornVault | ${data?.creator.name ?? 'Creator'}`}];
};

export async function loader({params, context}) {
  const {handle} = params;
  // Fetch creator data from Supabase
  // const creator = await fetchCreatorByHandle(handle);
  
  return {
    creator: {handle, name: 'Creator Name'}, // Replace with actual data
  };
}

export default function CreatorProfile() {
  const {creator} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-4xl font-bold text-gray-900">{creator.name}</h1>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
              Verified
            </span>
          </div>
          <p className="text-lg text-gray-600">
            View creator profile, verified badge, and browse current and past listings from this creator.
          </p>
        </div>
        
        {/* Creator bio, listings, and trust messaging will go here */}
      </div>
    </div>
  );
}