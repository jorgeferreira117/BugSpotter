
const FingerprintManager = require('./src/modules/FingerprintManager');

async function test() {
  const fm = new FingerprintManager();

  // Mock crypto for Node.js environment if needed (FingerprintManager uses crypto.subtle)
  // But wait, the module might use window.crypto. 
  // Let's see if we can mock it or if the existing class handles it.
  // The existing class uses `crypto.subtle.digest`.
  
  // Quick mock for crypto in Node
  const crypto = require('crypto');
  global.crypto = {
    subtle: {
      digest: async (algo, buffer) => {
        return crypto.createHash('sha256').update(buffer).digest();
      }
    }
  };
  global.TextEncoder = require('util').TextEncoder;

  const url1 = "https://pp.daloop.app/#/bu/FLOW_B2B/charging-area/stations/295174872/charging-sessions";
  const requestUrl1 = "https://pp.daloop.app/api/asset-snapshot-properties?filter[asset.id]=295174872-01&&filter[properties]=temperature";
  
  const url2 = "https://pp.daloop.app/#/bu/GALP_B2B/charging-area/stations/QA-SHARED-0001/charging-sessions";
  const requestUrl2 = "https://pp.daloop.app/api/asset-snapshot-properties?filter[asset.id]=QA-SHARED-0001-01&&filter[properties]=temperature";

  console.log('--- Testing Masking ---');
  console.log('ID 1:', fm._maskDynamicContent("295174872"));
  console.log('ID 2:', fm._maskDynamicContent("QA-SHARED-0001"));
  console.log('BU 1:', fm._maskDynamicContent("FLOW_B2B"));
  console.log('BU 2:', fm._maskDynamicContent("GALP_B2B"));
  
  console.log('\n--- Testing URL Normalization (checking hash handling) ---');
  console.log('URL 1:', fm._normalizeUrl(url1));
  console.log('URL 2:', fm._normalizeUrl(url2));

  console.log('\n--- Testing Request URL Masking ---');
  console.log('Req 1:', fm._maskDynamicContent(requestUrl1));
  console.log('Req 2:', fm._maskDynamicContent(requestUrl2));
  
  // Proposed Fix Regex
  const proposedRegex = /\b[a-z0-9-]*\d[a-z0-9-]*\b/gi;
  const testStr = "QA-SHARED-0001";
  console.log('\n--- Proposed Regex Test ---');
  console.log(`"${testStr}".replace(regex) ->`, testStr.replace(proposedRegex, '{id}'));
}

test();
