/**
 * @param {Route.ActionArgs}
 */
export async function action({params, context, request}) {
  // Whitelist only safe headers to prevent header injection and sensitive data leakage
  const safeHeaders = new Headers();
  const allowedHeaders = ['content-type', 'accept', 'user-agent'];
  
  allowedHeaders.forEach(header => {
    const value = request.headers.get(header);
    if (value) {
      safeHeaders.set(header, value);
    }
  });
  
  const response = await fetch(
    `https://${context.env.PUBLIC_CHECKOUT_DOMAIN}/api/${params.version}/graphql.json`,
    {
      method: 'POST',
      body: request.body,
      headers: safeHeaders,
    },
  );

  return new Response(response.body, {headers: new Headers(response.headers)});
}

/** @typedef {import('./+types/api.$version.[graphql.json]').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof action>} ActionReturnData */
