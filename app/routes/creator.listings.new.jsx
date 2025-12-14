import {useState, useRef, useEffect} from 'react';
import {Form, redirect} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {ChevronDownIcon, ChevronUpIcon, XMarkIcon} from '@heroicons/react/16/solid';
import {PhotoIcon} from '@heroicons/react/24/solid';

export const meta = () => {
  return [{title: 'WornVault | Create Listing'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  return {user};
}

export async function action({request, context}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  const formData = await request.formData();
  
  // Create listing in Supabase
  // const listing = await createListing(context, {
  //   category: formData.get('category'),
  //   description: formData.get('description'),
  //   price: formData.get('price'),
  //   // reference photos
  // });
  
  // Listing status → pending_approval
  // Not publicly visible
  
  return redirect('/creator/listings');
}

// Category options organized by type
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

export default function CreateListing() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [price, setPrice] = useState('');
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
    
    console.log('Files selected:', fileArray.length);
    
    // Filter to only image files
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    // Create preview URLs for all new files
    const newPhotos = imageFiles.map((file) => {
      try {
        const preview = URL.createObjectURL(file);
        console.log('Created preview URL:', preview, 'for file:', file.name, 'type:', file.type);
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
        console.log('Total photos after update:', updated.length);
        console.log('Photo previews:', updated.map(p => ({id: p.id, preview: p.preview?.substring(0, 50)})));
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

  // Debug: Log selectedPhotos changes
  useEffect(() => {
    console.log('selectedPhotos state changed:', {
      count: selectedPhotos.length,
      photos: selectedPhotos.map(p => ({
        id: p.id,
        fileName: p.file?.name,
        fileType: p.file?.type,
        preview: p.preview,
        previewValid: p.preview && p.preview.startsWith('blob:')
      }))
    });
  }, [selectedPhotos]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      // Clean up all blob URLs when component unmounts
      selectedPhotos.forEach((photo) => {
        if (photo.preview && photo.preview.startsWith('blob:')) {
          URL.revokeObjectURL(photo.preview);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Form method="post" encType="multipart/form-data">
          <div className="space-y-12">
            <div className="border-b border-gray-900/10 pb-12 dark:border-white/10">
              <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Listing Details</h2>
              <p className="mt-1 text-sm/6 text-gray-600 dark:text-gray-400">
                Provide information about your item. After submission, your listing will be set to pending
                approval and won't be publicly visible until approved.
              </p>

              <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                          className="relative cursor-pointer rounded-md bg-transparent font-semibold text-indigo-600 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:focus-within:outline-indigo-500 dark:hover:text-indigo-300"
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
                        <p className="pl-1">or drag and drop</p>
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
                                <img
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
                                    console.log('Image loaded successfully:', {
                                      preview: photo.preview,
                                      id: photo.id,
                                      fileName: photo.file?.name,
                                      naturalWidth: e.target.naturalWidth,
                                      naturalHeight: e.target.naturalHeight
                                    });
                                    // Remove from errors if it was there
                                    setImageErrors(prev => {
                                      const next = new Set(prev);
                                      next.delete(photo.id);
                                      return next;
                                    });
                                  }}
                                />
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
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:shadow-none dark:focus-visible:outline-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit for Approval
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.new').Route} Route */
