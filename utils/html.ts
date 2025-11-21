
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


/**
 * Extracts a complete HTML document from a string that might contain
 * conversational text, markdown code blocks, etc.
 */
export const extractHtmlFromText = (text: string): string => {
  if (!text) return "";

  // 1. Exact Match with closing tag (Most reliable)
  const htmlMatch = text.match(/(<!DOCTYPE html>|<html)[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    return htmlMatch[0];
  }

  // 2. Markdown Block Match (Reliable for code blocks)
  // Matches ```html ... ``` or just ``` ... ``` containing html tag
  // Updated to be more permissive about the start of the block
  const codeBlockMatch = text.match(/```(?:html)?\s*(<!DOCTYPE html>|<html[\s\S]*?)```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }
  
  // 3. Fallback: Start match until end of string or end of markdown block
  // This handles truncated output or missing closing tags.
  const startMatch = text.match(/(<!DOCTYPE html>|<html)[\s\S]*/i);
  if (startMatch) {
    let content = startMatch[0];
    // Strip trailing markdown fences if they exist at the very end
    content = content.replace(/```[\s\S]*$/, '');
    return content;
  }

  // 4. Return raw text if no structure is found (trim whitespace)
  return text.trim();
};

/**
 * Injects CSS into the HTML to hide common text elements (like loading screens,
 * info overlays, instructions)
 */
export const hideBodyText = (html: string): string => {
  const cssToInject = `
    <style>
      /* Hides common overlay IDs and classes used in Three.js examples and generated code */
      #info, #loading, #ui, #instructions, .label, .overlay, #description {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      /* Ensure the body doesn't show selected text cursor interaction outside canvas */
      body {
        user-select: none !important;
      }
    </style>
  `;

  // Inject before closing head if possible, otherwise before closing body, or append
  if (html.toLowerCase().includes('</head>')) {
    return html.replace(/<\/head>/i, `${cssToInject}</head>`);
  }
  if (html.toLowerCase().includes('</body>')) {
    return html.replace(/<\/body>/i, `${cssToInject}</body>`);
  }
  return html + cssToInject;
};

/**
 * Three.js scenes are often too zoomed out
 * Zooms the camera in by modifying the camera.position.set() call in the Three.js code.
 * This brings the camera closer to the center (0,0,0) by the specified factor.
 */
export const zoomCamera = (html: string, zoomFactor: number = 0.8): string => {
  // Regex to find camera.position.set(x, y, z)
  // Handles whitespace, newlines, and numeric values
  const regex = /camera\.position\.set\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;

  return html.replace(regex, (match, x, y, z) => {
    const newX = parseFloat(x) * zoomFactor;
    const newY = parseFloat(y) * zoomFactor;
    const newZ = parseFloat(z) * zoomFactor;
    return `camera.position.set(${newX}, ${newY}, ${newZ})`;
  });
};
