import * as fs from 'fs';
import * as path from 'path';

/**
 * Capture a screenshot of a website using the microlink.io free API.
 * No API key required for basic usage.
 *
 * Saves screenshot to skillDir/screenshots/homepage.png
 * Returns the local relative path, or null if capture fails.
 */
export async function captureScreenshot(
  url: string,
  skillDir: string
): Promise<string | null> {
  try {
    const screenshotsDir = path.join(skillDir, 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });

    // microlink.io with embed=screenshot.url returns the image bytes directly
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url&waitFor=2000`;

    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'skillui/1.0' },
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';

    // The embed=screenshot.url mode returns image bytes directly
    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) return null;
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const destPath = path.join(screenshotsDir, `homepage.${ext}`);
      fs.writeFileSync(destPath, buffer);
      return `screenshots/homepage.${ext}`;
    }

    // Fallback: try JSON response (without embed param behaviour)
    const text = await res.text();
    try {
      const json = JSON.parse(text) as any;
      const screenshotUrl = json?.data?.screenshot?.url;
      if (!screenshotUrl) return null;

      const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(20000) });
      if (!imgRes.ok) return null;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.length < 1000) return null;
      const destPath = path.join(screenshotsDir, 'homepage.jpg');
      fs.writeFileSync(destPath, buffer);
      return 'screenshots/homepage.jpg';
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
