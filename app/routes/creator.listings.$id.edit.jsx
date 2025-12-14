import {useState, useRef, useEffect} from 'react';
import {Form, redirect, useSubmit, useLoaderData, useNavigate, useActionData, useNavigation, data} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {ChevronDownIcon, ChevronUpIcon, XMarkIcon} from '@heroicons/react/16/solid';
import {PhotoIcon} from '@heroicons/react/24/solid';
import {fetchCreatorProfile, fetchCreatorListingById, createUserSupabaseClient} from '~/lib/supabase';

export const meta = ({data}) => {
  return [{title: `WornVault | Edit Listing ${data?.listing?.title ?? ''}`}];
};

export async function loader({params, context, request}) {
  console.log('[EDIT ROUTE] Loader called for listing edit page', {params});
  
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    throw new Response('Unauthorized', {status: 401});
  }

  const {id} = params;
  if (!id) {
    throw new Response('Listing ID required', {status: 400});
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    throw new Response('Server configuration error', {status: 500});
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
  
  if (!creatorProfile || !creatorProfile.id) {
    throw new Response('Creator profile not found', {status: 404});
  }

  // Fetch listing by ID
  const listing = await fetchCreatorListingById(id, creatorProfile.id, supabaseUrl, anonKey, accessToken);
  
  if (!listing) {
    throw new Response('Listing not found', {status: 404});
  }

  // Check if listing can be edited (only draft or pending_approval)
  const editableStatuses = ['draft', 'pending_approval'];
  const canEdit = editableStatuses.includes(listing.status);

  return {
    user,
    listing,
    canEdit,
  };
}

export async function action({request, context, params}) {
  try {
    // Require authentication
    const {user, session} = await requireAuth(request, context.env);
    
    if (!user?.email) {
      console.error('Action: User not authenticated');
      throw new Response('Unauthorized', {status: 401});
    }

    const {id} = params;
    if (!id) {
      throw new Response('Listing ID required', {status: 400});
    }

    const formData = await request.formData();
    
    // Extract form data
    const title = formData.get('title')?.toString().trim();
    const category = formData.get('category')?.toString().trim();
    const story = formData.get('description')?.toString().trim();
    const price = formData.get('price')?.toString();
    
    // Photo handling
    const existingPhotoIds = formData.get('existingPhotoIds')?.toString().split(',').filter(Boolean) || [];
    const deletedPhotoIds = formData.get('deletedPhotoIds')?.toString().split(',').filter(Boolean) || [];
    const newPhotos = formData.getAll('photos').filter(photo => photo instanceof File && photo.size > 0);

    // Validate required fields
    if (!title || !category || !story || !price) {
      console.error('Action: Missing required fields', {title, category, story, price});
      return data({error: 'Missing required fields'}, {status: 400});
    }

    // Validate price
    const priceFloat = parseFloat(price);
    if (isNaN(priceFloat) || priceFloat <= 0) {
      console.error('Action: Invalid price', {price});
      return data({error: 'Invalid price'}, {status: 400});
    }

    // Convert price to cents
    const priceCents = Math.round(priceFloat * 100);

    // Validate that we have at least one photo (existing or new)
    if (existingPhotoIds.length === 0 && newPhotos.length === 0) {
      return data({error: 'At least one photo is required'}, {status: 400});
    }

    const {createUserSupabaseClient} = await import('~/lib/supabase');
    const {fetchCreatorProfile} = await import('~/lib/supabase');
    
    const supabaseUrl = context.env.SUPABASE_URL;
    const anonKey = context.env.SUPABASE_ANON_KEY;
    const accessToken = session.access_token;

    if (!supabaseUrl || !anonKey || !accessToken) {
      console.error('Action: Missing Supabase configuration');
      return data({error: 'Server configuration error'}, {status: 500});
    }

    // Create Supabase client
    const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Get creator_id from email
    const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
    if (!creatorProfile || !creatorProfile.id) {
      console.error('Action: Creator profile not found', {email: user.email});
      return data({error: 'Creator profile not found. Please complete your profile first.'}, {status: 404});
    }

    const creatorId = creatorProfile.id;

    // Verify listing ownership
    const {data: existingListing, error: listingCheckError} = await supabase
      .from('listings')
      .select('id, status')
      .eq('id', id)
      .eq('creator_id', creatorId)
      .single();

    if (listingCheckError || !existingListing) {
      console.error('Action: Listing not found or unauthorized', listingCheckError);
      return data({error: 'Listing not found or unauthorized'}, {status: 404});
    }

    // Check if listing can be edited
    const editableStatuses = ['draft', 'pending_approval'];
    if (!editableStatuses.includes(existingListing.status)) {
      return data({error: 'This listing cannot be edited in its current status'}, {status: 403});
    }

    // Update listing record and set status to pending_approval for re-review
    console.log('Action: Updating listing with data:', {
      id,
      title,
      category,
      story,
      price_cents: priceCents,
      status: 'pending_approval',
    });
    
    const {error: updateError, data: updatedListing} = await supabase
      .from('listings')
      .update({
        title: title,
        category: category,
        story: story,
        price_cents: priceCents,
        status: 'pending_approval',
      })
      .eq('id', id)
      .eq('creator_id', creatorId)
      .select();

    if (updateError) {
      console.error('Action: Error updating listing:', updateError);
      return data({error: `Failed to update listing: ${updateError.message}`}, {status: 500});
    }
    
    console.log('Action: Listing updated successfully:', updatedListing);

    // Handle photo deletions
    if (deletedPhotoIds.length > 0) {
      // Fetch photo records to get storage paths
      const {data: photosToDelete, error: fetchPhotosError} = await supabase
        .from('listing_photos')
        .select('id, storage_path')
        .in('id', deletedPhotoIds)
        .eq('listing_id', id);

      if (!fetchPhotosError && photosToDelete) {
        // Delete from storage
        const storagePaths = photosToDelete.map(p => p.storage_path).filter(Boolean);
        if (storagePaths.length > 0) {
          const {error: storageDeleteError} = await supabase.storage
            .from('listing-photos')
            .remove(storagePaths);

          if (storageDeleteError) {
            console.error('Action: Error deleting photos from storage:', storageDeleteError);
            // Continue even if storage deletion fails
          }
        }

        // Delete photo records from database
        const {error: photoDeleteError} = await supabase
          .from('listing_photos')
          .delete()
          .in('id', deletedPhotoIds)
          .eq('listing_id', id);

        if (photoDeleteError) {
          console.error('Action: Error deleting photo records:', photoDeleteError);
          // Continue even if DB deletion fails
        }
      }
    }

    // Handle new photo uploads
    const uploadedPhotos = [];
    const errors = [];

    for (let i = 0; i < newPhotos.length; i++) {
      const photo = newPhotos[i];
      
      try {
        // Upload photo to Supabase Storage
        const sanitizedEmail = user.email
          .replace(/[@.]/g, '_')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .substring(0, 100);
        
        // Generate unique filename
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        
        // Extract file extension safely
        let fileExt = 'jpg'; // default
        if (photo.name && typeof photo.name === 'string') {
          const nameParts = photo.name.split('.');
          if (nameParts.length > 1) {
            fileExt = nameParts.pop().toLowerCase();
            // Validate extension
            const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            if (!validExts.includes(fileExt)) {
              fileExt = 'jpg'; // fallback to jpg
            }
          }
        } else if (photo.type && typeof photo.type === 'string') {
          // Try to get extension from MIME type
          const mimeToExt = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
          };
          fileExt = mimeToExt[photo.type] || 'jpg';
        }
        
        const fileName = `${timestamp}-${random}.${fileExt}`;
        const filePath = `listings/${sanitizedEmail}/${id}/${fileName}`;

        // Prepare upload payload
        let uploadPayload;
        let contentType = photo.type || 
                         (photo.name ? `image/${photo.name.split('.').pop()}` : 'image/jpeg');

        if (photo instanceof File || (typeof Blob !== 'undefined' && photo instanceof Blob)) {
          uploadPayload = photo;
        } else if (typeof photo.arrayBuffer === 'function') {
          uploadPayload = await photo.arrayBuffer();
        } else if (typeof photo.stream === 'function') {
          const stream = photo.stream();
          const chunks = [];
          const reader = stream.getReader();
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const buffer = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
          }
          uploadPayload = buffer.buffer;
        } else if (typeof photo.bytes === 'function') {
          uploadPayload = await photo.bytes();
        } else {
          try {
            const blob = typeof Blob !== 'undefined' && photo instanceof Blob 
              ? photo 
              : new Blob([photo], { type: contentType });
            uploadPayload = await blob.arrayBuffer();
          } catch (blobError) {
            console.error(`Action: Failed to convert photo ${i + 1} to Blob:`, blobError);
            uploadPayload = photo;
          }
        }

        // Upload to storage bucket
        const {data: uploadData, error: uploadError} = await supabase.storage
          .from('listing-photos')
          .upload(filePath, uploadPayload, {
            cacheControl: '3600',
            upsert: false,
            contentType: contentType,
          });

        if (uploadError) {
          console.error(`Action: Error uploading photo ${i + 1}:`, uploadError);
          errors.push(`Photo ${i + 1}: ${uploadError.message}`);
          continue;
        }

        // Create listing_photo record
        const {data: photoRecord, error: photoError} = await supabase
          .from('listing_photos')
          .insert({
            listing_id: id,
            storage_path: filePath,
            photo_type: 'reference',
          })
          .select()
          .single();

        if (photoError) {
          console.error(`Action: Error creating photo record ${i + 1}:`, photoError);
          errors.push(`Photo ${i + 1}: Failed to save photo record: ${photoError.message}`);
          // Try to delete uploaded file if record creation failed
          await supabase.storage.from('listing-photos').remove([filePath]);
          continue;
        }

        uploadedPhotos.push(photoRecord);
      } catch (err) {
        console.error(`Action: Unexpected error processing photo ${i + 1}:`, err);
        errors.push(`Photo ${i + 1}: ${err.message || 'Unexpected error'}`);
      }
    }

    // If some photos failed but at least one succeeded, log warnings but continue
    if (errors.length > 0) {
      console.warn('Action: Some photos failed to upload:', errors);
    }

    console.log('Action: Listing updated successfully, redirecting...');
    // Success - redirect to listings page with success parameter
    return redirect('/creator/listings?updated=true');
  } catch (error) {
    console.error('Action: Unexpected error updating listing:', error);
    console.error('Action: Error stack:', error.stack);
    return data(
      {error: `An unexpected error occurred: ${error.message || 'Unknown error'}`},
      {status: 500}
    );
  }
}

// Category options organized by type (same as create page)
const CATEGORIES = {
  clothing: [
    'Tops & Blouses',
    'Dresses',
    'Bottoms & Pants',
    'Skirts',
    'Outerwear',
    'Activewear',
    'Swimwear',
    'Lingerie & Underwear',
    'Intimate Apparel',
    'Adult Content Clothing',
    'Accessories',
    'Shoes',
    'Jewelry',
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

// Flatten categories for search
const ALL_CATEGORIES = [
  ...CATEGORIES.clothing.map(cat => ({value: cat, type: 'clothing'})),
  ...CATEGORIES.marketplace.map(cat => ({value: cat, type: 'marketplace'})),
];

export default function EditListing() {
  const loaderData = useLoaderData();
  const {listing, canEdit} = loaderData || {};
  const navigate = useNavigate();
  const actionData = useActionData();
  const navigation = useNavigation();
  
  console.log('[EDIT ROUTE] Component rendered', {hasListing: !!listing, canEdit, loaderData});
  
  // Debug: Log to verify this component is rendering
  useEffect(() => {
    console.log('[EDIT ROUTE] EditListing component mounted - this confirms the edit route is working!');
  }, []);
  
  // Track submission state from navigation
  const isSubmitting = navigation.state === 'submitting';
  
  // Debug: Log action data and navigation state
  useEffect(() => {
    if (actionData) {
      console.log('[EDIT ROUTE] Action data received:', actionData);
    }
    console.log('[EDIT ROUTE] Navigation state:', navigation.state);
  }, [actionData, navigation.state]);
  
  // Handle case where listing data might not be loaded
  if (!listing) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
        <div className="pb-32 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              Error Loading Listing
            </h2>
            <p className="text-sm text-red-700 dark:text-red-300 mb-4">
              Unable to load listing data. Please try again or contact support.
            </p>
            <button
              onClick={() => navigate('/creator/listings')}
              className="text-sm font-medium text-red-800 dark:text-red-200 hover:underline"
            >
              Back to Listings →
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  const [selectedCategory, setSelectedCategory] = useState(listing.category || '');
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  
  // Photo state: combine existing photos (with URLs) and new photos (File objects)
  const [existingPhotos, setExistingPhotos] = useState(
    listing.photos?.map(photo => ({
      id: photo.id,
      url: photo.publicUrl,
      storagePath: photo.storage_path,
      isExisting: true,
    })) || []
  );
  const [newPhotos, setNewPhotos] = useState([]);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState(new Set());
  
  const [price, setPrice] = useState(listing.price || '');
  const [imageErrors, setImageErrors] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const categoryRef = useRef(null);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Filter categories based on search
  const filteredCategories = categorySearch
    ? ALL_CATEGORIES.filter(cat =>
        cat.value.toLowerCase().includes(categorySearch.toLowerCase())
      )
    : ALL_CATEGORIES;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        categoryRef.current &&
        !categoryRef.current.contains(event.target)
      ) {
        setIsCategoryOpen(false);
        setCategorySearch('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Process files (used by both file input and drag & drop)
  const processFiles = (files) => {
    const fileArray = Array.from(files || []);
    if (fileArray.length === 0) return;
    
    // Filter to only image files
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    // Create preview URLs for all new files
    const newPhotoItems = imageFiles.map((file) => {
      try {
        const preview = URL.createObjectURL(file);
        return {
          file,
          preview,
          id: `new-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          isExisting: false,
        };
      } catch (error) {
        console.error('Error creating preview URL:', error);
        return null;
      }
    }).filter(Boolean);
    
    if (newPhotoItems.length > 0) {
      setNewPhotos((prev) => [...prev, ...newPhotoItems]);
    }
  };

  // Handle photo selection from file input
  const handlePhotoChange = (e) => {
    processFiles(e.target.files);
  };

  // Handle drag and drop
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    processFiles(files);
  };

  // Remove photo from selection (existing or new)
  const handleRemovePhoto = (photoId, isExisting) => {
    if (isExisting) {
      // Mark existing photo for deletion
      setDeletedPhotoIds(prev => new Set([...prev, photoId]));
      setExistingPhotos(prev => prev.filter(p => p.id !== photoId));
    } else {
      // Remove new photo and revoke URL
      const photo = newPhotos.find(p => p.id === photoId);
      if (photo && photo.preview) {
        URL.revokeObjectURL(photo.preview);
      }
      setNewPhotos(prev => prev.filter(p => p.id !== photoId));
    }
  };

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      // Clean up all blob URLs when component unmounts
      newPhotos.forEach((photo) => {
        if (photo.preview && photo.preview.startsWith('blob:')) {
          URL.revokeObjectURL(photo.preview);
        }
      });
    };
  }, []); // Only run cleanup on unmount

  // Handle category selection
  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    setIsCategoryOpen(false);
    setCategorySearch('');
  };

  // Handle price increment/decrement
  const handlePriceIncrement = () => {
    const currentValue = parseFloat(price) || 0;
    const newValue = (currentValue + 1.00).toFixed(2);
    setPrice(newValue);
  };

  const handlePriceDecrement = () => {
    const currentValue = parseFloat(price) || 0;
    if (currentValue > 0) {
      const newValue = Math.max(0, currentValue - 1.00).toFixed(2);
      setPrice(newValue);
    }
  };

  const submit = useSubmit();

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!canEdit) {
      alert('This listing cannot be edited in its current status');
      return;
    }
    
    // Validate required fields
    if (!selectedCategory) {
      alert('Please select a category');
      return;
    }
    
    if (!price || parseFloat(price) <= 0) {
      alert('Please enter a valid price');
      return;
    }
    
    // Validate that we have at least one photo (existing or new)
    const remainingExistingPhotos = existingPhotos.filter(p => !deletedPhotoIds.has(p.id));
    if (remainingExistingPhotos.length === 0 && newPhotos.length === 0) {
      alert('Please keep at least one photo or add a new one');
      return;
    }

    // Manually construct FormData
    const formData = new FormData();
    
    // Add form fields
    const form = e.target;
    const titleInput = form.querySelector('[name="title"]');
    const descriptionInput = form.querySelector('[name="description"]');
    const priceInput = form.querySelector('[name="price"]');
    
    if (titleInput) formData.append('title', titleInput.value);
    formData.append('category', selectedCategory);
    if (descriptionInput) formData.append('description', descriptionInput.value);
    if (priceInput) formData.append('price', priceInput.value);
    
    // Add existing photo IDs (to keep)
    const remainingPhotoIds = existingPhotos
      .filter(p => !deletedPhotoIds.has(p.id))
      .map(p => p.id);
    formData.append('existingPhotoIds', remainingPhotoIds.join(','));
    
    // Add deleted photo IDs
    if (deletedPhotoIds.size > 0) {
      formData.append('deletedPhotoIds', Array.from(deletedPhotoIds).join(','));
    }
    
    // Add new photo files
    newPhotos.forEach((photo) => {
      if (photo.file) {
        formData.append('photos', photo.file);
      }
    });

    // Submit the form
    submit(formData, {
      method: 'post',
      encType: 'multipart/form-data',
    });
  };

  // If listing cannot be edited, show message
  if (!canEdit) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              Listing Cannot Be Edited
            </h2>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-4">
              This listing cannot be edited because it is in "{listing.status}" status. 
              Only listings with "draft" or "pending_approval" status can be edited.
            </p>
            <button
              onClick={() => navigate(`/creator/listings/${listing.id}`)}
              className="text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline"
            >
              View Listing Details →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Combine all photos for display
  const allPhotos = [
    ...existingPhotos.map(p => ({...p, isExisting: true})),
    ...newPhotos.map(p => ({...p, isExisting: false})),
  ];

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="pb-32 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Edit Listing</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Update your listing details. Changes will be saved immediately.
          </p>
        </div>

        {actionData?.error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {actionData.error}
            </p>
          </div>
        )}

        <Form method="post" encType="multipart/form-data" onSubmit={handleSubmit}>
          <div className="space-y-12">
            <div className="border-b border-gray-900/10 pb-12 dark:border-white/10">
              <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Listing Details</h2>
              <p className="mt-1 text-sm/6 text-gray-600 dark:text-gray-400">
                Update information about your item.
              </p>

              <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
                {/* Title Field */}
                <div className="col-span-full">
                  <label htmlFor="title" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Title *
                  </label>
                  <div className="mt-2">
                    <input
                      type="text"
                      id="title"
                      name="title"
                      required
                      defaultValue={listing.title}
                      placeholder="Enter a title for your listing..."
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                    />
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">A short, descriptive title for your item.</p>
                </div>

                {/* Category Dropdown */}
                <div className="col-span-full">
                  <label htmlFor="category" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Category *
                  </label>
                  <div className="mt-2 relative">
                    <input
                      type="hidden"
                      name="category"
                      value={selectedCategory}
                      required
                    />
                    <div className="grid grid-cols-1">
                      <button
                        type="button"
                        ref={categoryRef}
                        onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                        className={`col-start-1 row-start-1 w-full appearance-none rounded-md bg-white py-1.5 pr-8 pl-3 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:focus:outline-indigo-500 text-left ${
                          !selectedCategory ? 'text-gray-400 dark:text-gray-500' : ''
                        }`}
                      >
                        {selectedCategory || 'Select a category'}
                      </button>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={`pointer-events-none col-start-1 row-start-1 mr-2 size-5 self-center justify-self-end text-gray-500 sm:size-4 dark:text-gray-400 transition-transform ${
                          isCategoryOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </div>

                    {isCategoryOpen && (
                      <div
                        ref={dropdownRef}
                        className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/10 rounded-md shadow-lg max-h-80 overflow-hidden outline-1 -outline-offset-1 outline-gray-300 dark:outline-white/10"
                      >
                        {/* Search input */}
                        <div className="p-2 border-b border-gray-200 dark:border-white/10">
                          <input
                            type="text"
                            value={categorySearch}
                            onChange={(e) => setCategorySearch(e.target.value)}
                            placeholder="Search categories..."
                            className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-gray-800 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                            autoFocus
                          />
                        </div>

                        {/* Category list */}
                        <div className="max-h-64 overflow-y-auto">
                          {filteredCategories.length === 0 ? (
                            <div className="px-4 py-3 text-sm/6 text-gray-500 dark:text-gray-400">
                              No categories found
                            </div>
                          ) : (
                            filteredCategories.map((cat) => (
                              <button
                                key={cat.value}
                                type="button"
                                onClick={() => handleCategorySelect(cat.value)}
                                className={`w-full text-left px-4 py-2 text-sm/6 hover:bg-gray-100 dark:hover:bg-white/10 ${
                                  selectedCategory === cat.value
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                    : 'text-gray-900 dark:text-white'
                                }`}
                              >
                                {cat.value}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Description Field */}
                <div className="col-span-full">
                  <label htmlFor="description" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Description *
                  </label>
                  <div className="mt-2">
                    <textarea
                      id="description"
                      name="description"
                      required
                      rows={6}
                      defaultValue={listing.story}
                      placeholder="Describe your item..."
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                    />
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">Write a detailed description of your item.</p>
                </div>

                {/* Price Field */}
                <div className="sm:col-span-3">
                  <label htmlFor="price" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Price (USD) *
                  </label>
                  <div className="mt-2 relative">
                    <div className="absolute inset-y-0 right-0 pr-3 flex flex-col items-center justify-center gap-0.5">
                      <button
                        type="button"
                        onClick={handlePriceIncrement}
                        className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:text-indigo-600 dark:focus:text-indigo-400 transition-colors"
                        aria-label="Increase price"
                      >
                        <ChevronUpIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handlePriceDecrement}
                        className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:text-indigo-600 dark:focus:text-indigo-400 transition-colors"
                        aria-label="Decrease price"
                      >
                        <ChevronDownIcon className="size-4" />
                      </button>
                    </div>
                    <input
                      type="number"
                      id="price"
                      name="price"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="block w-full rounded-md bg-white px-3 py-1.5 pr-12 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                    />
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">Enter the price in USD</p>
                </div>

                {/* Photo Upload */}
                <div className="col-span-full">
                  <label htmlFor="photos" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Reference Photos *
                  </label>
                  <div
                    ref={dropZoneRef}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`mt-2 flex justify-center rounded-lg border border-dashed px-6 py-10 transition-colors ${
                      isDragging
                        ? 'border-indigo-600 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-900/20'
                        : 'border-gray-900/25 dark:border-white/25'
                    }`}
                  >
                    <div className="text-center">
                      <PhotoIcon aria-hidden="true" className="mx-auto size-12 text-gray-300 dark:text-gray-600" />
                      <div className="mt-4 flex text-sm/6 text-gray-600 dark:text-gray-400">
                        <label
                          htmlFor="photos"
                          className="relative pr-1 cursor-pointer rounded-md bg-transparent font-semibold text-indigo-600 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:focus-within:outline-indigo-500 dark:hover:text-indigo-300"
                        >
                          <span>Upload files</span>
                          <input
                            ref={fileInputRef}
                            id="photos"
                            name="photos"
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="sr-only"
                          />
                        </label>
                        <p className="pl-2">or drag and drop</p>
                      </div>
                      <p className="text-xs/5 text-gray-600 dark:text-gray-400">PNG, JPG, GIF up to 10MB</p>
                    </div>
                  </div>

                  {/* Photo Preview Grid */}
                  {allPhotos.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm/6 font-medium text-gray-900 dark:text-white mb-4">
                        Selected Photos ({allPhotos.length})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {allPhotos.map((photo, index) => {
                          return (
                            <div
                              key={photo.id || `photo-${index}`}
                              className="relative group rounded-lg overflow-hidden border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5"
                              style={{
                                aspectRatio: '1 / 1',
                                minHeight: '150px',
                                position: 'relative'
                              }}
                            >
                              {(photo.url || photo.preview) && !imageErrors.has(photo.id) ? (
                                <img
                                  src={photo.url || photo.preview}
                                  alt={`Preview ${index + 1}`}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  style={{
                                    display: 'block'
                                  }}
                                  onError={(e) => {
                                    console.error('Failed to load image preview:', {
                                      preview: photo.url || photo.preview,
                                      id: photo.id,
                                    });
                                    setImageErrors(prev => new Set(prev).add(photo.id));
                                  }}
                                  onLoad={(e) => {
                                    setImageErrors(prev => {
                                      const next = new Set(prev);
                                      next.delete(photo.id);
                                      return next;
                                    });
                                  }}
                                />
                              ) : (photo.url || photo.preview) && imageErrors.has(photo.id) ? (
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-200 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-xs p-2">
                                  <div className="text-center">
                                    <p>Image</p>
                                    <p className="text-red-500 mt-1">Preview unavailable</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
                                  <div className="text-center">
                                    <p>No preview</p>
                                  </div>
                                </div>
                              )}
                              {photo.isExisting && (
                                <div className="absolute top-2 left-2 px-2 py-1 bg-blue-500 text-white text-xs rounded">
                                  Existing
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemovePhoto(photo.id, photo.isExisting)}
                                className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg"
                                aria-label="Remove photo"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          <div className="mt-6 flex items-center justify-end gap-x-6">
            <button
              type="button"
              onClick={() => navigate(`/creator/listings/${listing.id}`)}
              className="text-sm/6 font-semibold text-gray-900 dark:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:shadow-none dark:focus-visible:outline-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                'Submit for Review'
              )}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.$id.edit').Route} Route */
