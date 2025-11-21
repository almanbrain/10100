
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { GoogleGenAI, Modality } from "@google/genai";
import { extractHtmlFromText } from "../utils/html";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const IMAGE_SYSTEM_PROMPT = "Generate an architectural concept or structural element on a clean background. High contrast, clear form.";

export const PARAMETRIC_PROMPT = `
You are an expert Creative Technologist and Three.js specialist.
I have provided an image of an architectural structure.
Your task is to write a single, self-contained HTML file containing a Three.js application that procedurally regenerates this structure.

**CORE REQUIREMENT**: The 3D model must **visually resemble** the input image in terms of:
1. **Silhouette/Profile**: (e.g., hourglass, tapered, twisting, stepped, organic).
2. **Footprint/Plan**: (e.g., circle, square, star, complex polygon, organic curves).
3. **Surface Texture**: (e.g., ribs, panels, lattice, Voronoi patterns).

**TECHNICAL CONSTRAINTS**:
1. **Libraries**: Use Three.js r160 from unpkg. Include this exact importmap:
   <script type="importmap">
     {
       "imports": {
         "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
         "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
       }
     }
   </script>
2. **Setup**:
   - Scene, PerspectiveCamera, WebGLRenderer.
   - **CRITICAL**: Set \`preserveDrawingBuffer: true\` in WebGLRenderer constructor (required for screenshots).
   - Enable shadows (\`renderer.shadowMap.enabled = true\`).
   - **OrbitControls** (autoRotate: true).
3. **Architecture**:
   - Use \`THREE.InstancedMesh\` if the structure is composed of many similar layers (highly recommended for performance).
   - OR use \`THREE.BufferGeometry\` constructed procedurally if the shape is continuous and organic.
   - **DO NOT** simply stack primitive cylinders unless the image dictates it. Trace the footprint using \`THREE.Shape\` and \`THREE.ExtrudeGeometry\`.
4. **Parametric API**:
   - You must expose \`window.updateParams(scale, height, levels)\` on the global scope.
   - \`scale\`: Global XY scale factor.
   - \`height\`: Global Y scale factor or spacing multiplier.
   - \`levels\`: Number of vertical segments/layers.
   - When \`updateParams\` is called, you must **dispose()** of old geometries/materials to prevent memory leaks before creating new ones.
   - **CRITICAL**: Wrap the entire logic inside \`updateParams\` in a \`try { ... } catch (e) { console.error(e); }\` block.
5. **Lighting & Atmosphere**:
   - Expose \`window.setLightingPreset(name)\`.
   - Handle presets: 'Studio', 'Daylight', 'Sunset', 'Night', 'Golden Hour', 'Stormy'.
   - **Fog**: Use \`scene.fog = new THREE.FogExp2(color, density)\`.
   - Expose \`window.updateFog(color, density)\`. \`color\` is a hex string/number, \`density\` is a float (0.0 to 0.1).
6. **Exports**:
   - \`window.getOBJ()\` must use \`OBJExporter\` from 'three/addons/exporters/OBJExporter.js' to return the scene as an OBJ string.
   - \`window.getScreenshot()\` must return \`renderer.domElement.toDataURL('image/png')\`.
   - \`window.getSurfaceArea()\` returns total surface area (number) (approximate is fine).
   - \`window.getFloorArea()\` returns total floor area (number) (approximate is fine).

**VISUAL STYLE**:
- Use \`THREE.MeshPhysicalMaterial\` or \`MeshStandardMaterial\`.
- Enable shadows (\`castShadow\`, \`receiveShadow\`) for all meshes and lights.
- Use \`THREE.ACESFilmicToneMapping\`.
- Background should default to the 'Studio' preset (light gray/white).

**OUTPUT**:
- Return ONLY the valid HTML code.
- Start with \`<!DOCTYPE html>\`.
- **IMPORTANT**: Call \`window.updateParams(1.0, 1.0, 20)\` at the very end of your script to initialize the scene immediately.
`;

export const generateImage = async (prompt: string, aspectRatio: string = '1:1', optimize: boolean = true): Promise<string> => {
  try {
    let finalPrompt = prompt;

    // Apply the shortened optimization prompt if enabled
    if (optimize) {
      finalPrompt = `${IMAGE_SYSTEM_PROMPT}\n\nSubject: ${prompt}`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: finalPrompt,
          },
        ],
      },
      config: {
        responseModalities: [
            'IMAGE',
        ],
        imageConfig: {
          aspectRatio: aspectRatio,
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData) {
        const base64ImageBytes = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${base64ImageBytes}`;
    } else {
      throw new Error("No image generated.");
    }
  } catch (error) {
    console.error("Image generation failed:", error);
    throw error;
  }
};

export const generateParametricModel = async (
  imageBase64: string, 
  onThoughtUpdate?: (thought: string) => void
): Promise<string> => {
  // Extract the base64 data part if it includes the prefix
  const base64Data = imageBase64.split(',')[1] || imageBase64;
  
  // Extract MIME type from the data URL if present, otherwise default to jpeg
  const mimeMatch = imageBase64.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  let fullHtml = "";

  try {
    // Using gemini-3-pro-preview for complex code generation with thinking
    const response = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: PARAMETRIC_PROMPT
          }
        ]
      },
      config: {
        thinkingConfig: {
          thinkingBudget: 16000, 
        },
        maxOutputTokens: 20000, // Ensure full code generation
      },
    });

    for await (const chunk of response) {
      const candidates = chunk.candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
          // Cast to any to access 'thought' property if not in current type definition
          const p = part as any;
          
          if (p.thought) {
            if (onThoughtUpdate && p.text) {
              onThoughtUpdate(p.text);
            }
          } else {
            if (p.text) {
              fullHtml += p.text;
            }
          }
        }
      }
    }

    return extractHtmlFromText(fullHtml);

  } catch (error) {
    console.error("Parametric model generation failed:", error);
    throw error;
  }
};

export const generateRealisticRender = async (
  imageBase64: string,
  prompt: string
): Promise<string> => {
  try {
     const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
     // Default mime if not found, though we expect standard data URIs
     const mimeType = 'image/png'; 

     const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: `Photorealistic architectural visualization of this structure. High quality, detailed materials, realistic lighting. Context: ${prompt}`,
          },
        ],
      },
      config: {
          responseModalities: ['IMAGE'],
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData) {
        const base64ImageBytes = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${base64ImageBytes}`;
    } else {
      throw new Error("No render generated.");
    }

  } catch (error) {
      console.error("Realistic render failed:", error);
      throw error;
  }
}
