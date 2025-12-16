import {useState, useRef, useEffect, useMemo} from 'react';
import {Form, redirect, useSubmit, useLoaderData} from 'react-router';
import {requireAuth, generateCSRFToken, getClientIP} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {sanitizeHTML} from '~/lib/sanitize';
import {ALL_CATEGORIES} from '~/lib/categories';
import {ChevronDownIcon, ChevronUpIcon, XMarkIcon} from '@heroicons/react/16/solid';
import {PhotoIcon} from '@heroicons/react/24/solid';

export const meta = () => {
  return [{title: 'WornVault | Create Listing'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  return {user, csrfToken};
}

export async function action({request, context}) {
  try {
    // Require authentication
    const {user, session} = await requireAuth(request, context.env);
    
    if (!user?.email || !session?.access_token) {
      return new Response('Unauthorized', {status: 401});
    }

    // Rate limiting: max 10 requests per minute per user
    const clientIP = getClientIP(request);
    const rateLimitKey = `create-listing:${user.email}:${clientIP}`;
    const rateLimit = await rateLimitMiddleware(request, rateLimitKey, {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
    });
    
    if (!rateLimit.allowed) {
      return new Response(
        `Too many requests. Please wait a moment before trying again. You can try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`,
        {status: 429}
      );
    }

    const formData = await request.formData();
    
    // Validate CSRF token
    const csrfToken = formData.get('csrf_token');
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || csrfToken !== storedCSRFToken) {
      return new Response('Invalid security token. Please refresh the page and try again.', {status: 403});
    }
    
    // Clear CSRF token after use (one-time use)
    context.session.unset('csrf_token');
    
    // Extract form data
    const title = formData.get('title')?.toString().trim();
    const category = formData.get('category')?.toString().trim();
    const condition = formData.get('condition')?.toString().trim();
    const story = formData.get('description')?.toString().trim();
    const price = formData.get('price')?.toString();
    const photos = formData.getAll('photos');

    // Sanitize inputs
    const MAX_TITLE_LENGTH = 200;
    const MAX_STORY_LENGTH = 5000;
    const sanitizedTitle = title
      ? title.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_TITLE_LENGTH)
      : '';
    const sanitizedCategory = category
      ? category.replace(/[^a-zA-Z0-9\s&'-]/g, '').substring(0, 100)
      : '';
    const sanitizedStory = story
      ? sanitizeHTML(story).substring(0, MAX_STORY_LENGTH)
      : '';

    // Validate required fields with sanitized values
    if (!sanitizedTitle || !sanitizedCategory || !sanitizedStory || !price) {
      return new Response('Missing required fields', {status: 400});
    }

    // Validate category against allowed list
    const {VALID_CATEGORIES} = await import('~/lib/categories');
    
    if (!VALID_CATEGORIES.includes(sanitizedCategory)) {
      return new Response('Invalid category selected', {status: 400});
    }

    // Validate price
    const priceFloat = parseFloat(price);
    if (isNaN(priceFloat) || priceFloat <= 0) {
      return new Response('Invalid price', {status: 400});
    }

    // Convert price to cents
    const priceCents = Math.round(priceFloat * 100);

    // Validate photos with size and MIME type checks
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    
    const validPhotos = photos.filter(photo => {
      if (!photo || !(photo instanceof File) || photo.size === 0) return false;
      if (photo.size > MAX_FILE_SIZE) {
        console.warn(`Photo ${photo.name} exceeds size limit`);
        return false;
      }
      // Validate MIME type
      if (!ALLOWED_IMAGE_TYPES.includes(photo.type)) {
        console.warn(`Photo ${photo.name} has invalid MIME type: ${photo.type}`);
        return false;
      }
      return true;
    });

    if (validPhotos.length === 0) {
      return new Response('At least one photo is required', {status: 400});
    }

    const {createUserSupabaseClient} = await import('~/lib/supabase');
    const {fetchCreatorProfile} = await import('~/lib/supabase');
    
    const supabaseUrl = context.env.SUPABASE_URL;
    const anonKey = context.env.SUPABASE_ANON_KEY;
    const accessToken = session.access_token;

    if (!supabaseUrl || !anonKey || !accessToken) {
      console.error('Action: Missing Supabase configuration', {
        hasUrl: !!supabaseUrl,
        hasKey: !!anonKey,
        hasToken: !!accessToken,
      });
      return new Response('Server configuration error', {status: 500});
    }

    // Create Supabase client
    const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Get creator_id from email
    const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
    if (!creatorProfile || !creatorProfile.id) {
      console.error('Action: Creator profile not found', {email: user.email});
      return new Response('Creator profile not found. Please complete your profile first.', {status: 404});
    }

    const creatorId = creatorProfile.id;

    // Create listing record
    const {data: listing, error: listingError} = await supabase
      .from('listings')
      .insert({
        creator_id: creatorId,
        title: sanitizedTitle,
        category: sanitizedCategory,
        condition: sanitizedCondition,
        story: sanitizedStory,
        price_cents: priceCents,
        currency: 'USD',
        status: 'pending_approval',
      })
      .select()
      .single();

    if (listingError) {
      console.error('Action: Error creating listing:', listingError);
      return new Response(`Failed to create listing: ${listingError.message}`, {status: 500});
    }

    if (!listing || !listing.id) {
      console.error('Action: Listing created but no ID returned', {listing});
      return new Response('Failed to create listing', {status: 500});
    }

    const listingId = listing.id;

    // Upload photos and create listing_photos records
    const uploadedPhotos = [];
    const errors = [];

    for (let i = 0; i < validPhotos.length; i++) {
      const photo = validPhotos[i];
      
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
        const filePath = `listings/${sanitizedEmail}/${listingId}/${fileName}`;

        // Try to upload directly first (Supabase might accept File/Blob objects)
        // If that fails, convert to ArrayBuffer
        let uploadPayload;
        let contentType = photo.type || 
                         (photo.name ? `image/${photo.name.split('.').pop()}` : 'image/jpeg');

        // Try to use the photo directly if it's a File or Blob
        if (photo instanceof File || (typeof Blob !== 'undefined' && photo instanceof Blob)) {
          uploadPayload = photo;
        } else if (typeof photo.arrayBuffer === 'function') {
          uploadPayload = await photo.arrayBuffer();
        } else if (typeof photo.stream === 'function') {
          // Convert stream to ArrayBuffer
          const stream = photo.stream();
          const chunks = [];
          const reader = stream.getReader();
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          // Combine chunks into single ArrayBuffer
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
          // Last resort: try to convert to Blob
          try {
            const blob = typeof Blob !== 'undefined' && photo instanceof Blob 
              ? photo 
              : new Blob([photo], { type: contentType });
            uploadPayload = await blob.arrayBuffer();
          } catch (blobError) {
            console.error(`Action: Failed to convert photo ${i + 1} to Blob:`, blobError);
            // Try passing the object directly - Supabase might handle it
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
            listing_id: listingId,
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

    // If no photos were successfully uploaded, delete the listing
    if (uploadedPhotos.length === 0) {
      console.error('Action: No photos uploaded, deleting listing', {listingId, errors});
      await supabase.from('listings').delete().eq('id', listingId);
      return new Response(
        `Failed to upload photos: ${errors.join('; ')}`,
        {status: 500}
      );
    }

    // If some photos failed but at least one succeeded, log warnings but continue
    if (errors.length > 0) {
      console.warn('Action: Some photos failed to upload:', errors);
    }

    // Success - redirect to listings page with success parameter
    return redirect('/creator/listings?submitted=true');
  } catch (error) {
    console.error('Action: Unexpected error creating listing:', error);
    console.error('Action: Error stack:', error.stack);
    return new Response(
      `An unexpected error occurred: ${error.message || 'Unknown error'}`,
      {status: 500}
    );
  }
}


export default function CreateListing() {
  const loaderData = useLoaderData();
  const {csrfToken} = loaderData || {};
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [selectedCondition, setSelectedCondition] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [price, setPrice] = useState('');
  const [imageErrors, setImageErrors] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Track image version for refresh (for consistency, though this page redirects after save)
  const [imageVersion, setImageVersion] = useState(0);
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
    const newPhotos = imageFiles.map((file) => {
      try {
        const preview = URL.createObjectURL(file);
        return {
          file,
          preview,
          id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        };
      } catch (error) {
        console.error('Error creating preview URL:', error);
        return null;
      }
    }).filter(Boolean); // Remove any null entries
    
    if (newPhotos.length > 0) {
      setSelectedPhotos((prev) => {
        const updated = [...prev, ...newPhotos];
        return updated;
      });
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

  // Remove photo from selection
  const handleRemovePhoto = (photoId) => {
    setSelectedPhotos((prev) => {
      const photo = prev.find((p) => p.id === photoId);
      if (photo && photo.preview) {
        URL.revokeObjectURL(photo.preview);
      }
      const updated = prev.filter((p) => p.id !== photoId);
      
      // Update the file input to reflect remaining files
      if (fileInputRef.current) {
        const dataTransfer = new DataTransfer();
        updated.forEach((p) => dataTransfer.items.add(p.file));
        fileInputRef.current.files = dataTransfer.files;
      }
      
      return updated;
    });
  };


  // Cleanup object URLs on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      // Clean up all blob URLs when component unmounts
      selectedPhotos.forEach((photo) => {
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

  // Handle form submission with files from state
  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!selectedCategory) {
      alert('Please select a category');
      return;
    }
    
    if (!selectedCondition) {
      alert('Please select a condition');
      return;
    }
    
    if (!price || parseFloat(price) <= 0) {
      alert('Please enter a valid price');
      return;
    }
    
    // Validate that we have photos
    if (selectedPhotos.length === 0) {
      alert('Please select at least one photo');
      return;
    }

    // Set loading state
    setIsSubmitting(true);

    // Manually construct FormData with files from state
    const formData = new FormData();
    
    // Add CSRF token
    if (csrfToken) {
      formData.append('csrf_token', csrfToken);
    }
    
    // Add form fields - use form elements or state values
    const form = e.target;
    const titleInput = form.querySelector('[name="title"]');
    const descriptionInput = form.querySelector('[name="description"]');
    const priceInput = form.querySelector('[name="price"]');
    
    if (titleInput) formData.append('title', titleInput.value);
    formData.append('category', selectedCategory);
    formData.append('condition', selectedCondition);
    if (descriptionInput) formData.append('description', descriptionInput.value);
    if (priceInput) formData.append('price', priceInput.value);
    
    // Add files from selectedPhotos state
    selectedPhotos.forEach((photo) => {
      if (photo.file) {
        formData.append('photos', photo.file);
      }
    });

    // Submit the form with our FormData
    submit(formData, {
      method: 'post',
      encType: 'multipart/form-data',
    });
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="pb-32 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Form method="post" encType="multipart/form-data" onSubmit={handleSubmit}>
          <input type="hidden" name="csrf_token" value={csrfToken || ''} />
          <div className="space-y-12">
            <div className="border-b border-gray-900/10 pb-12 dark:border-white/10">
              <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Listing Details</h2>
              <p className="mt-1 text-sm/6 text-gray-600 dark:text-gray-400">
                Provide information about your item. After submission, your listing will be set to pending
                approval and won't be publicly visible until approved.
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

                {/* Condition Dropdown */}
                <div className="col-span-full">
                  <label htmlFor="condition" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Condition *
                  </label>
                  <div className="mt-2">
                    <select
                      id="condition"
                      name="condition"
                      value={selectedCondition}
                      onChange={(e) => setSelectedCondition(e.target.value)}
                      required
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:focus:outline-indigo-500"
                    >
                      <option value="">Select condition...</option>
                      <option value="Barely worn">Barely worn</option>
                      <option value="Lightly worn">Lightly worn</option>
                      <option value="Heavily worn">Heavily worn</option>
                    </select>
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">Select the condition of your item.</p>
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
                  {selectedPhotos.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm/6 font-medium text-gray-900 dark:text-white mb-4">
                        Selected Photos ({selectedPhotos.length})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {selectedPhotos.map((photo, index) => {
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
                              {photo.preview && !imageErrors.has(photo.id) ? (
                                <>
                                  <img
                                    key={`${photo.id}-${imageVersion}`}
                                    src={photo.preview}
                                    alt={`Preview ${index + 1}: ${photo.file?.name || 'image'}`}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{
                                      display: 'block'
                                    }}
                                    onError={(e) => {
                                      console.error('Failed to load image preview:', {
                                        preview: photo.preview,
                                        id: photo.id,
                                        fileName: photo.file?.name,
                                        error: e
                                      });
                                      // Mark this image as having an error
                                      setImageErrors(prev => new Set(prev).add(photo.id));
                                    }}
                                    onLoad={(e) => {
                                      // Image loaded successfully
                                      // Remove from errors if it was there
                                      setImageErrors(prev => {
                                        const next = new Set(prev);
                                        next.delete(photo.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  {/* Loading overlay when submitting */}
                                  {isSubmitting && (
                                    <div className="absolute inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-10">
                                      <div className="flex flex-col items-center gap-1">
                                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <p className="text-xs text-white">Uploading...</p>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : photo.preview && imageErrors.has(photo.id) ? (
                                // Error fallback - shown when image fails to load
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-200 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-xs p-2">
                                  <div className="text-center">
                                    <p>{photo.file?.name || 'Image'}</p>
                                    <p className="text-red-500 mt-1">Preview unavailable</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
                                  <div className="text-center">
                                    <p>No preview</p>
                                    <p className="text-xs mt-1">{photo.file?.name || ''}</p>
                                  </div>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemovePhoto(photo.id)}
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
              onClick={() => window.history.back()}
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
                'Submit for Approval'
              )}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.new').Route} Route */
