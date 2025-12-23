/**
 * Shopify Admin API Utilities
 * 
 * This module provides functions to interact with Shopify Admin API
 * for creating and managing products.
 * 
 * Required environment variables:
 * - SHOPIFY_ADMIN_CLIENT_ID: Client ID from Shopify Dev Dashboard
 * - SHOPIFY_ADMIN_CLIENT_SECRET: Client Secret from Shopify Dev Dashboard
 * - PUBLIC_STORE_DOMAIN: Your Shopify store domain (e.g., 'your-store.myshopify.com')
 * 
 * Note: Access tokens are obtained via OAuth client credentials flow and cached for 24 hours
 */

// In-memory token cache (valid for 24 hours)
let tokenCache = {
  accessToken: null,
  expiresAt: null,
};

/**
 * Gets an Admin API access token using OAuth client credentials flow
 * Tokens are cached for 24 hours to avoid unnecessary API calls
 * 
 * @param {string} clientId - Shopify app Client ID
 * @param {string} clientSecret - Shopify app Client Secret
 * @param {string} storeDomain - Shopify store domain
 * @returns {Promise<{accessToken: string | null, error: Error | null}>}
 */
async function getAdminAccessToken(clientId, clientSecret, storeDomain) {
  // Check if we have a valid cached token
  if (tokenCache.accessToken && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
    return {
      accessToken: tokenCache.accessToken,
      error: null,
    };
  }

  if (!clientId || !clientSecret || !storeDomain) {
    return {
      accessToken: null,
      error: new Error('Client ID, Client Secret, and store domain are required'),
    };
  }

  try {
    const response = await fetch(
      `https://${storeDomain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify OAuth error:', {
        status: response.status,
        statusText: response.statusText,
        ...(isProduction ? {} : {body: errorText}),
      });
      return {
        accessToken: null,
        error: new Error(
          `Failed to get access token: ${response.status} ${response.statusText}`
        ),
      };
    }

    const result = await response.json();

    if (!result.access_token) {
      return {
        accessToken: null,
        error: new Error('No access token in OAuth response'),
      };
    }

    // Cache the token (valid for 24 hours, cache for 23 hours to be safe)
    const expiresIn = result.expires_in || 86400; // Default to 24 hours
    tokenCache = {
      accessToken: result.access_token,
      expiresAt: Date.now() + (expiresIn - 3600) * 1000, // Cache for 23 hours
    };

    return {
      accessToken: result.access_token,
      error: null,
    };
  } catch (error) {
    // Log error without exposing sensitive credentials
    const isProduction = process.env.NODE_ENV === 'production';
    console.error('Error getting Shopify access token:', {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      ...(isProduction ? {} : {stack: error.stack}),
    });
    return {
      accessToken: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Creates a Shopify product using Admin API GraphQL mutation
 * 
 * @param {object} productData - Product data object
 * @param {string} productData.title - Product title
 * @param {string} productData.productType - Product type/category
 * @param {string} productData.description - Product description (HTML)
 * @param {string} productData.vendor - Product vendor (creator display name)
 * @param {string} productData.price - Price as string (e.g., "29.99")
 * @param {string} productData.sku - SKU (listing UUID)
 * @param {string} productData.condition - Condition value for metafield
 * @param {string} clientId - Shopify app Client ID
 * @param {string} clientSecret - Shopify app Client Secret
 * @param {string} storeDomain - Shopify store domain
 * @returns {Promise<{productId: string | null, error: Error | null}>}
 */
export async function createShopifyProduct(
  productData,
  clientId,
  clientSecret,
  storeDomain
) {
  if (!clientId || !clientSecret || !storeDomain) {
    return {
      productId: null,
      error: new Error('Shopify Client ID, Client Secret, and store domain are required'),
    };
  }

  // Get access token using OAuth client credentials flow
  const {accessToken, error: tokenError} = await getAdminAccessToken(
    clientId,
    clientSecret,
    storeDomain
  );

  if (tokenError || !accessToken) {
    return {
      productId: null,
      error: tokenError || new Error('Failed to obtain access token'),
    };
  }

  const {
    title,
    productType,
    description,
    vendor,
    price,
    sku,
    condition,
  } = productData;

  // Validate required fields
  if (!title || !price || !sku || !vendor) {
    return {
      productId: null,
      error: new Error('Missing required product fields: title, price, sku, or vendor'),
    };
  }

  // GraphQL mutation for creating a product with metafield
  // Note: variants cannot be created in ProductInput, must be created separately
  // Note: Using regular template string (not #graphql) because this is Admin API, not Storefront API
  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Prepare the product input (without variants - they're created separately)
  // Note: Metafields are created separately after product creation to avoid uniqueness issues
  const variables = {
    input: {
      title: title.trim(),
      productType: productType || '',
      vendor: vendor.trim(),
      status: 'ACTIVE',
      descriptionHtml: description || '',
      // Don't create metafields during product creation - do it separately
      // This avoids uniqueness constraint issues
    },
  };

  try {
    // Step 1: Create the product
    const productResponse = await fetch(
      `https://${storeDomain}/admin/api/2024-10/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables,
        }),
      }
    );

    if (!productResponse.ok) {
      const errorText = await productResponse.text();
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify API error response:', {
        status: productResponse.status,
        statusText: productResponse.statusText,
        ...(isProduction ? {} : {body: errorText}),
      });
      return {
        productId: null,
        error: new Error(
          `Shopify API error: ${productResponse.status} ${productResponse.statusText}`
        ),
      };
    }

    const productResult = await productResponse.json();

    // Check for GraphQL errors
    if (productResult.errors) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify GraphQL errors:', isProduction 
        ? productResult.errors.map(e => e.message).join('; ')
        : productResult.errors
      );
      // Sanitize error messages - don't expose internal details
      const errorMessages = productResult.errors
        .map((e) => e.message)
        .filter(msg => msg && typeof msg === 'string')
        .map(msg => msg.substring(0, 200)) // Limit length
        .join(', ');
      return {
        productId: null,
        error: new Error(`Shopify API error: ${errorMessages || 'Unknown error'}`),
      };
    }

    // Check for user errors from the mutation
    const userErrors = productResult.data?.productCreate?.userErrors || [];
    if (userErrors.length > 0) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify user errors:', isProduction
        ? userErrors.map(e => e.message).join('; ')
        : userErrors
      );
      // Sanitize error messages
      const errorMessages = userErrors
        .map((e) => e.message)
        .filter(msg => msg && typeof msg === 'string')
        .map(msg => msg.substring(0, 200)) // Limit length
        .join(', ');
      return {
        productId: null,
        error: new Error(`Shopify validation error: ${errorMessages || 'Unknown error'}`),
      };
    }

    const product = productResult.data?.productCreate?.product;
    if (!product || !product.id) {
      return {
        productId: null,
        error: new Error('No product ID returned from Shopify'),
      };
    }

    const productId = product.id;

    // Step 2: Get the default variant that was automatically created with the product
    // Products automatically get a default variant, so we need to fetch it and update it
    const getProductQuery = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const getProductVariables = {
      id: productId,
    };

    const getProductResponse = await fetch(
      `https://${storeDomain}/admin/api/2024-10/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: getProductQuery,
          variables: getProductVariables,
        }),
      }
    );

    if (!getProductResponse.ok) {
      const errorText = await getProductResponse.text();
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify get product error:', {
        status: getProductResponse.status,
        statusText: getProductResponse.statusText,
        ...(isProduction ? {} : {body: errorText}),
      });
      return {
        productId,
        error: new Error(
          `Product created but failed to get variant: ${getProductResponse.status} ${getProductResponse.statusText}`
        ),
      };
    }

    const getProductResult = await getProductResponse.json();

    if (getProductResult.errors) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify GraphQL errors getting product:', isProduction
        ? getProductResult.errors.map(e => e.message).join('; ')
        : getProductResult.errors
      );
      const errorMessages = getProductResult.errors
        .map((e) => e.message)
        .filter(msg => msg && typeof msg === 'string')
        .map(msg => msg.substring(0, 200))
        .join(', ');
      return {
        productId,
        error: new Error(`Failed to get variant: ${errorMessages || 'Unknown error'}`),
      };
    }

    const variantNode = getProductResult.data?.product?.variants?.edges?.[0]?.node;
    if (!variantNode || !variantNode.id) {
      return {
        productId,
        error: new Error('Product created but no variant found'),
      };
    }

    const variantId = variantNode.id;

    // Step 3: Update the default variant with price and SKU using REST API
    // GraphQL Admin API has issues with productVariantUpdate in some versions
    // Using REST API is more reliable for variant updates
    
    // Format price correctly for Shopify (must be a string with 2 decimal places)
    const priceFloat = parseFloat(price);
    if (isNaN(priceFloat) || priceFloat <= 0) {
      return {
        productId: null,
        error: new Error(`Invalid price: ${price}. Price must be a positive number.`),
      };
    }
    const formattedPrice = priceFloat.toFixed(2);

    // Ensure SKU is a string (Shopify requires string or null)
    const skuString = sku ? sku.toString() : null;

    // Extract variant ID from GID format (gid://shopify/ProductVariant/46507717492887 -> 46507717492887)
    const variantIdNumber = variantId.split('/').pop();

    console.log('Updating variant with:', {
      variantId,
      variantIdNumber,
      price: formattedPrice,
      sku: skuString,
    });

    // Use REST API to update variant
    const variantUpdateResponse = await fetch(
      `https://${storeDomain}/admin/api/2024-10/variants/${variantIdNumber}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          variant: {
            id: parseInt(variantIdNumber, 10),
            price: formattedPrice,
            sku: skuString,
            inventory_policy: 'deny', // Don't allow overselling
          },
        }),
      }
    );

    const variantUpdateText = await variantUpdateResponse.text();
    let variantUpdateResult;
    
    try {
      variantUpdateResult = JSON.parse(variantUpdateText);
    } catch (parseError) {
      console.error('Failed to parse variant update response:', variantUpdateText);
      return {
        productId: null,
        error: new Error(`Invalid JSON response from Shopify: ${variantUpdateText}`),
      };
    }

    if (!variantUpdateResponse.ok) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify variant update API error:', {
        status: variantUpdateResponse.status,
        statusText: variantUpdateResponse.statusText,
        ...(isProduction ? {} : {
          body: variantUpdateText,
          requestPayload: {
            variantId,
            variantIdNumber,
            price: formattedPrice,
            sku: skuString,
          },
        }),
      });
      // Product was created successfully, but variant update failed
      // Return productId so it can be saved, but also return error for logging/retry
      // This allows the listing to be created with the Shopify product ID even if variant update fails
      // Sanitize error message - don't expose full response body
      return {
        productId,
        error: new Error(
          `Product created but variant update failed: ${variantUpdateResponse.status} ${variantUpdateResponse.statusText}`
        ),
      };
    }

    // Check for REST API errors
    if (variantUpdateResult.errors) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify REST API errors updating variant:', isProduction
        ? 'Error updating variant'
        : {
          errors: variantUpdateResult.errors,
          requestPayload: {
            variantId,
            variantIdNumber,
            price: formattedPrice,
            sku: skuString,
          },
        }
      );
      // Product was created successfully, but variant update had errors
      // Return productId so it can be saved, but also return error for logging/retry
      // This allows the listing to be created with the Shopify product ID even if variant update fails
      const errorMessages = Array.isArray(variantUpdateResult.errors)
        ? variantUpdateResult.errors
            .map(e => typeof e === 'string' ? e : JSON.stringify(e))
            .map(msg => msg.substring(0, 200))
            .join(', ')
        : String(variantUpdateResult.errors).substring(0, 200);
      return {
        productId,
        error: new Error(`Variant update failed: ${errorMessages || 'Unknown error'}`),
      };
    }

    // Verify the variant was updated successfully
    const updatedVariant = variantUpdateResult.variant;
    if (!updatedVariant) {
      console.error('No variant returned from update:', variantUpdateResult);
      // Product was created successfully, but variant update response was unexpected
      // Return productId so it can be saved, but also return error for logging
      return {
        productId,
        error: new Error('Variant update succeeded but no variant data returned'),
      };
    }

    // Verify SKU and price were set correctly
    console.log('Variant updated successfully:', {
      variantId: updatedVariant.id,
      sku: updatedVariant.sku,
      price: updatedVariant.price,
      expectedSku: skuString,
      expectedPrice: formattedPrice,
    });

    // Step 4: Create metafield separately (after product creation to avoid uniqueness issues)
    if (condition) {
      const metafieldMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const metafieldVariables = {
        metafields: [
          {
            ownerId: productId,
            namespace: 'custom',
            key: 'worn_level',
            value: condition,
            type: 'single_line_text_field',
          },
        ],
      };

      const metafieldResponse = await fetch(
        `https://${storeDomain}/admin/api/2024-10/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: metafieldMutation,
            variables: metafieldVariables,
          }),
        }
      );

      const metafieldText = await metafieldResponse.text();
      let metafieldResult;
      
      try {
        metafieldResult = JSON.parse(metafieldText);
      } catch (parseError) {
        console.warn('Failed to parse metafield response (non-critical):', metafieldText);
        // Metafield creation is not critical - continue
      }

      if (metafieldResult && (metafieldResult.errors || metafieldResult.data?.metafieldsSet?.userErrors?.length > 0)) {
        const metafieldErrors = metafieldResult.errors || metafieldResult.data.metafieldsSet.userErrors;
        console.warn('Metafield creation failed (non-critical):', {
          errors: metafieldErrors,
          condition,
        });
        // Metafield creation is not critical - product and variant are created successfully
      } else if (metafieldResult?.data?.metafieldsSet?.metafields) {
        console.log('Metafield created successfully:', metafieldResult.data.metafieldsSet.metafields[0]);
      }
    }

    // Success - product created, variant updated with price and SKU, and metafield set
    return {
      productId,
      error: null,
    };
  } catch (error) {
    console.error('Error creating Shopify product:', error);
    return {
      productId: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Updates a Shopify product's metafield
 * Useful if you need to update the condition later
 * 
 * @param {string} productId - Shopify product GID
 * @param {string} condition - Condition value
 * @param {string} clientId - Shopify app Client ID
 * @param {string} clientSecret - Shopify app Client Secret
 * @param {string} storeDomain - Shopify store domain
 * @returns {Promise<{success: boolean, error: Error | null}>}
 */
export async function updateProductMetafield(
  productId,
  condition,
  clientId,
  clientSecret,
  storeDomain
) {
  if (!productId || !condition || !clientId || !clientSecret || !storeDomain) {
    return {
      success: false,
      error: new Error('Missing required parameters'),
    };
  }

  // Get access token using OAuth client credentials flow
  const {accessToken, error: tokenError} = await getAdminAccessToken(
    clientId,
    clientSecret,
    storeDomain
  );

  if (tokenError || !accessToken) {
    return {
      success: false,
      error: tokenError || new Error('Failed to obtain access token'),
    };
  }

  // Note: Using regular template string (not #graphql) because this is Admin API, not Storefront API
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId: productId,
        namespace: 'custom',
        key: 'worn_level',
        value: condition,
        type: 'single_line_text_field',
      },
    ],
  };

  try {
    const response = await fetch(
      `https://${storeDomain}/admin/api/2024-10/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify metafield API error:', {
        status: response.status,
        statusText: response.statusText,
        ...(isProduction ? {} : {body: errorText}),
      });
      return {
        success: false,
        error: new Error(
          `Shopify API error: ${response.status} ${response.statusText}`
        ),
      };
    }

    const result = await response.json();

    if (result.errors || result.data?.metafieldsSet?.userErrors?.length > 0) {
      const errors = result.errors || result.data.metafieldsSet.userErrors;
      const isProduction = process.env.NODE_ENV === 'production';
      console.error('Shopify metafield errors:', isProduction
        ? errors.map(e => e.message).join('; ')
        : errors
      );
      const errorMessages = errors
        .map((e) => e.message)
        .filter(msg => msg && typeof msg === 'string')
        .map(msg => msg.substring(0, 200))
        .join(', ');
      return {
        success: false,
        error: new Error(`Shopify errors: ${errorMessages || 'Unknown error'}`),
      };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

