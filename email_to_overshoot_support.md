# Email to Overshoot Support

**Subject:** API Endpoint Access Issue - DNS Resolution Failure for api.overshoot.ai

---

**To:** support@overshoot.ai (or developers@overshoot.ai / contact via https://overshoot.ai)

**Subject:** API Endpoint Access Issue - DNS Resolution Failure for api.overshoot.ai

---

Hi Overshoot Support Team,

I'm integrating the Overshoot AI SDK (`@overshoot/sdk` v0.1.0-alpha.1) into my application for real-time video streaming analysis. However, I'm encountering a DNS resolution error when attempting to connect to the API endpoint.

**Issue:**
The SDK is trying to connect to `https://api.overshoot.ai`, but I'm getting `ERR_NAME_NOT_RESOLVED` (DNS lookup failure). The error occurs when the SDK attempts to make a POST request to `https://api.overshoot.ai/streams`.

**What I've Verified:**
- ✅ I have a valid API key (starts with `ovs_...`)
- ✅ The API key is correctly formatted and cleaned of special characters
- ✅ The SDK is configured correctly (matching the playground settings)
- ✅ The Overshoot API Playground works successfully on my machine
- ✅ My network connection is functional
- ❌ The domain `api.overshoot.ai` does not resolve via DNS

**Technical Details:**
- SDK Version: `@overshoot/sdk@0.1.0-alpha.1`
- Configuration:
  - `apiUrl: 'https://api.overshoot.ai'`
  - `backend: 'overshoot'`
  - `model: 'Qwen/Qwen3-VL-30B-A3B-Instruct'`
  - Camera source with `cameraFacing: 'environment'`

**Error Logs:**
```
POST https://api.overshoot.ai/streams net::ERR_NAME_NOT_RESOLVED
NetworkError: Network error: Failed to fetch
```

**Questions:**
1. Is `https://api.overshoot.ai` the correct endpoint URL for SDK usage, or is there a different endpoint for programmatic access?
2. Does the API require special network access, DNS configuration, or whitelisting?
3. Is the API endpoint currently publicly available, or is it in private beta?
4. Since the playground works on my machine, is it using a different endpoint or proxy that I should be aware of?
5. Are there any regional restrictions or network requirements I need to be aware of?

**Additional Context:**
The Overshoot API Playground successfully starts streams (I can see `[RealtimeVision] Stream started` in the console), which confirms my API key is valid and the service is accessible through the web interface. However, the SDK cannot resolve the API domain when used programmatically.

I'd appreciate any guidance on:
- The correct API endpoint URL for SDK usage
- Network/DNS requirements
- Any authentication or configuration steps I might be missing

Thank you for your time and assistance!

Best regards,
[Your Name]

---

**Alternative Shorter Version:**

---

**Subject:** Question: Correct API Endpoint for @overshoot/sdk

Hi Overshoot Team,

I'm using `@overshoot/sdk` (v0.1.0-alpha.1) for real-time video streaming, but getting DNS resolution failures for `api.overshoot.ai`. 

The playground works fine on my machine, but the SDK can't resolve the API domain (`ERR_NAME_NOT_RESOLVED` when calling `https://api.overshoot.ai/streams`).

Could you confirm:
1. Is `https://api.overshoot.ai` the correct endpoint?
2. Are there special network/DNS requirements?
3. Is the endpoint publicly available or requires whitelisting?

Thanks!
[Your Name]
