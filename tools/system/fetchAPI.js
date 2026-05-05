/**
 * Fetch API Tool - Safe REST API caller for retrieving public data.
 */
export default async function fetchAPI(args) {
  const { endpoint, method = 'GET' } = args;
  if (!endpoint) return { success: false, error: "Grace, Rocky needs an API endpoint." };

  console.log(`[Tool: fetchAPI] Fetching: ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: method.toUpperCase(),
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data: JSON.stringify(data).substring(0, 500) + '...' }; // Limit output length
  } catch (error) {
    console.error(`[Tool: fetchAPI] Error:`, error);
    return { success: false, error: "Rocky couldn't fetch the data." };
  }
}
