
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { generateImage, generateParametricModel, generateRealisticRender } from './services/gemini';
import { extractHtmlFromText, hideBodyText, zoomCamera } from './utils/html';

type AppStatus = 'idle' | 'generating_image' | 'generating_model' | 'error';

const LIGHTING_PRESETS = ['Studio', 'Daylight', 'Sunset', 'Night', 'Golden Hour', 'Stormy'];

const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
];

const SAMPLE_PROMPTS = [
    "Zaha Hadid fluid parametric center",
    "Santiago Calatrava organic white bridge",
    "Frank Gehry titanium undulating museum",
    "Bjarke Ingels stepped pixel skyscraper",
    "Sou Fujimoto white lattice cloud structure"
];

const App: React.FC = () => {
  // --- State ---
  const [prompt, setPrompt] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  
  const [imageData, setImageData] = useState<string | null>(null);
  const [sceneCode, setSceneCode] = useState<string | null>(null);
  
  const [status, setStatus] = useState<AppStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [useOptimization, setUseOptimization] = useState(true);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  
  const [viewMode, setViewMode] = useState<'image' | 'model'>('image');
  const [lightingPreset, setLightingPreset] = useState('Studio');
  const [estimatedArea, setEstimatedArea] = useState<number | null>(null);
  const [floorArea, setFloorArea] = useState<number | null>(null);
  
  const [parametricParams, setParametricParams] = useState({
    scale: 1.0,
    height: 1.0,
    levels: 20
  });

  const [fogColor, setFogColor] = useState('#f0f0f0');
  const [fogDensity, setFogDensity] = useState(0.01);
  
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  // Realistic Render State
  const [renderModalOpen, setRenderModalOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [renderPrompt, setRenderPrompt] = useState('');
  const [renderedImage, setRenderedImage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // --- Effects ---

  // Initialize from URL Params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('prompt')) setPrompt(params.get('prompt')!);
    if (params.has('aspect')) setAspectRatio(params.get('aspect')!);
    if (params.has('lighting')) setLightingPreset(params.get('lighting')!);
    
    if (params.has('scale') || params.has('height') || params.has('levels')) {
        setParametricParams({
            scale: parseFloat(params.get('scale') || '1.0'),
            height: parseFloat(params.get('height') || '1.0'),
            levels: parseInt(params.get('levels') || '20')
        });
    }
  }, []);

  // Cycle placeholders
  useEffect(() => {
    const interval = setInterval(() => {
        setPlaceholderIndex((prev) => (prev + 1) % SAMPLE_PROMPTS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [thinkingText]);

  // Sync params with Iframe
  const updateIframeParams = () => {
    if (viewMode === 'model' && iframeRef.current) {
        try {
            const win = iframeRef.current.contentWindow as any;
            if (win) {
                if (win.updateParams) {
                    win.updateParams(parametricParams.scale, parametricParams.height, parametricParams.levels);
                }
                // Try to fetch area
                if (win.getSurfaceArea) {
                    try {
                        const area = win.getSurfaceArea();
                        if (typeof area === 'number' && !isNaN(area)) {
                            setEstimatedArea(area);
                        }
                    } catch (e) { /* Ignore area errors */ }
                }
                // Try to fetch floor area
                if (win.getFloorArea) {
                    try {
                        const fArea = win.getFloorArea();
                        if (typeof fArea === 'number' && !isNaN(fArea)) {
                            setFloorArea(fArea);
                        }
                    } catch (e) { /* Ignore area errors */ }
                }
            }
        } catch (e) { /* Ignore */ }
    }
  };

  // Sync lighting with Iframe
  const updateIframeLighting = () => {
      if (viewMode === 'model' && iframeRef.current) {
          try {
              const win = iframeRef.current.contentWindow as any;
              if (win && win.setLightingPreset) {
                  win.setLightingPreset(lightingPreset);
              }
          } catch (e) { /* Ignore */ }
      }
  };

  // Sync Fog with Iframe
  const updateIframeFog = () => {
      if (viewMode === 'model' && iframeRef.current) {
          try {
              const win = iframeRef.current.contentWindow as any;
              if (win && win.updateFog) {
                  win.updateFog(fogColor, fogDensity);
              }
          } catch (e) { /* Ignore */ }
      }
  };

  // Effect to sync geometry params
  useEffect(() => {
    updateIframeParams();
  }, [parametricParams, viewMode]);

  // Effect to sync lighting params
  useEffect(() => {
    updateIframeLighting();
  }, [lightingPreset, viewMode]);

  // Effect to sync fog params
  useEffect(() => {
      updateIframeFog();
  }, [fogColor, fogDensity, viewMode]);

  const handleIframeLoad = () => {
      // Module scripts run deferred. Polling ensures we catch it when ready.
      let attempts = 0;
      const maxAttempts = 300; // 30 seconds timeout
      
      const checkReady = () => {
          const win = iframeRef.current?.contentWindow as any;
          if (win && win.updateParams) {
              // Add a slight delay to ensure GL context is ready
              setTimeout(() => {
                  updateIframeParams();
                  updateIframeLighting();
                  updateIframeFog();
              }, 200);
          } else {
              attempts++;
              if (attempts < maxAttempts) {
                  setTimeout(checkReady, 100);
              } else {
                  console.warn("Iframe connection timed out. The model may still be loading or encountered an error.");
              }
          }
      };
      
      checkReady();
  };

  // --- Handlers ---

  const handleError = (err: any) => {
    setStatus('error');
    setErrorMsg(err.message || 'An unexpected error occurred.');
    console.error(err);
  };

  const handleImageGenerate = async () => {
    if (!prompt.trim()) return;
    setStatus('generating_image');
    setErrorMsg('');
    setImageData(null);
    setSceneCode(null);
    setEstimatedArea(null);
    setFloorArea(null);
    setThinkingText("Initializing image generation pipeline...");
    setViewMode('image');

    try {
      const imageUrl = await generateImage(prompt, aspectRatio, useOptimization);
      setImageData(imageUrl);
      setStatus('idle');
      setThinkingText(null);
    } catch (err) {
      handleError(err);
    }
  };

  const processFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      handleError(new Error("Invalid file type. Allowed: PNG, JPEG, WEBP, HEIC."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageData(result);
      setSceneCode(null);
      setEstimatedArea(null);
      setFloorArea(null);
      setViewMode('image');
      setStatus('idle');
      setErrorMsg('');
    };
    reader.onerror = () => handleError(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handleGenerateModel = async () => {
    if (!imageData) return;
    setStatus('generating_model');
    setErrorMsg('');
    setThinkingText("Initializing geometry synthesis...");
    
    let thoughtBuffer = "";

    try {
      const codeRaw = await generateParametricModel(imageData, (thoughtFragment) => {
          thoughtBuffer += thoughtFragment;
          const matches = thoughtBuffer.match(/\*\*([^*]+)\*\*/g);
          if (matches && matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              const header = lastMatch.replace(/\*\*/g, '').trim();
              setThinkingText(prev => prev === header ? prev : header);
          } else if (thoughtBuffer.length < 100) {
             setThinkingText("Analyzing image structure...");
          }
      });
      
      if (!codeRaw || codeRaw.trim().length === 0) {
          throw new Error("Failed to generate valid model code. Please try again.");
      }

      const code = zoomCamera(hideBodyText(codeRaw));
      setSceneCode(code);
      
      setEstimatedArea(null);
      setFloorArea(null);
      setViewMode('model');
      setStatus('idle');
      setThinkingText(null);
    } catch (err) {
      handleError(err);
    }
  };

  const handleDownload = () => {
    if (viewMode === 'image' && imageData) {
      const a = document.createElement('a');
      a.href = imageData;
      const ext = imageData.includes('image/jpeg') ? 'jpg' : 'png';
      a.download = `parametric-concept-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (viewMode === 'model' && sceneCode) {
      const a = document.createElement('a');
      a.href = `data:text/html;charset=utf-8,${encodeURIComponent(sceneCode)}`;
      a.download = `parametric-model-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleExportOBJ = async () => {
    if (viewMode === 'model' && iframeRef.current) {
        try {
            const win = iframeRef.current.contentWindow as any;
            if (win && win.getOBJ) {
                setThinkingText("Exporting 3D geometry...");
                setStatus('generating_model'); // Reuse generic busy state
                
                const objData = await win.getOBJ();
                if (objData) {
                    const blob = new Blob([objData], { type: 'text/plain' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `parametric-model-${Date.now()}.obj`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                } else {
                    throw new Error("Model export returned empty data");
                }
                
                setStatus('idle');
                setThinkingText(null);
            } else {
                alert("Export function not available in this model. Try regenerating.");
            }
        } catch (e) {
            console.error(e);
            setStatus('idle');
            setThinkingText(null);
            setErrorMsg("Failed to export model. See console.");
        }
    }
  };
  
  const handleShare = () => {
    const params = new URLSearchParams();
    if (prompt) params.set('prompt', prompt);
    params.set('aspect', aspectRatio);
    params.set('scale', parametricParams.scale.toString());
    params.set('height', parametricParams.height.toString());
    params.set('levels', parametricParams.levels.toString());
    params.set('lighting', lightingPreset);
    
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
        setShowCopiedToast(true);
        setTimeout(() => setShowCopiedToast(false), 3000);
    }).catch(() => {
        alert("Failed to copy link. URL: " + url);
    });
  };

  const handleOpenRenderModal = () => {
      if (viewMode === 'model' && iframeRef.current) {
          try {
            const win = iframeRef.current.contentWindow as any;
            if (win && win.getScreenshot) {
                const shot = win.getScreenshot();
                if (shot) {
                    setScreenshot(shot);
                    setRenderPrompt(prompt ? `Realistic photo of ${prompt}, atmospheric lighting, 8k uhd` : "Realistic architectural photography, 8k uhd, photorealistic, cinematic lighting");
                    setRenderedImage(null);
                    setRenderModalOpen(true);
                } else {
                    alert("Could not capture screenshot. Scene may not be ready.");
                }
            } else {
                alert("Screenshot function not enabled in this model.");
            }
          } catch (e) {
              console.error(e);
          }
      }
  };

  const handleGenerateRender = async () => {
      if (!screenshot || !renderPrompt) return;
      
      setIsRendering(true);
      setErrorMsg('');
      
      try {
          const result = await generateRealisticRender(screenshot, renderPrompt);
          setRenderedImage(result);
      } catch (e: any) {
          setErrorMsg(e.message || "Failed to generate render");
      } finally {
          setIsRendering(false);
      }
  };

  const handleDownloadRender = () => {
      if (renderedImage) {
        const a = document.createElement('a');
        a.href = renderedImage;
        a.download = `realistic-render-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
  };

  const isLoading = status !== 'idle' && status !== 'error';
  
  // Icons
  const IconCube = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>;
  const IconImage = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>;
  const IconUpload = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>;
  const IconDownload = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;
  const IconShare = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>;
  const IconEye = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>;
  const IconLayers = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>;
  const IconCamera = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>;
  const IconX = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-white text-black font-sans selection:bg-black selection:text-white">
      
      {/* === SIDEBAR === */}
      <div className="w-full md:w-[400px] lg:w-[450px] flex flex-col border-r border-gray-200 bg-white h-full overflow-y-auto flex-shrink-0 z-20 shadow-xl md:shadow-none">
         
         {/* Header */}
         <div className="p-6 border-b border-gray-100 flex items-baseline justify-between sticky top-0 bg-white/90 backdrop-blur-sm z-10">
            <h1 className="text-2xl font-black tracking-tight uppercase">Parametric<span className="text-gray-400">.Tower</span></h1>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
         </div>
         
         <div className="flex-1 flex flex-col gap-8 p-6">

            {/* Section: Input / Generation */}
            <section>
                 <h2 className="text-xs font-bold uppercase text-gray-400 tracking-wider mb-4">Concept Generator</h2>
                 
                 <div className="space-y-4">
                    {/* Prompt Input */}
                    <div className="relative">
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={SAMPLE_PROMPTS[placeholderIndex]}
                            className="w-full h-24 p-3 bg-gray-50 border border-gray-200 focus:border-black focus:outline-none resize-none text-sm font-medium placeholder-gray-400 transition-colors"
                            disabled={isLoading}
                        />
                        <div className="absolute bottom-2 right-2">
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="p-2 bg-white border border-gray-200 hover:border-black hover:text-black text-gray-400 transition-all rounded-sm"
                                title="Upload Reference Image"
                            >
                                <IconUpload />
                            </button>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept={ALLOWED_MIME_TYPES.join(',')} />
                        </div>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleImageGenerate}
                        disabled={isLoading || !prompt.trim()}
                        className="w-full h-12 bg-black text-white font-bold uppercase tracking-widest text-xs hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-transform active:scale-[0.99]"
                    >
                        {status === 'generating_image' ? 'Processing...' : 'Generate Concept'}
                    </button>
                 </div>
            </section>

            <hr className="border-gray-100" />

            {/* Section: Parametric Controls */}
            <section className={`flex-1 flex flex-col gap-6 transition-opacity duration-300 ${viewMode === 'model' ? 'opacity-100' : 'opacity-30 pointer-events-none grayscale'}`}>
                 <div className="flex justify-between items-center flex-wrap gap-2">
                     <h2 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Parametric Controls</h2>
                     <div className="flex flex-col items-end gap-1">
                        {estimatedArea !== null && (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono bg-gray-50 border border-gray-200 px-2 py-1 rounded-sm text-gray-600" title="Estimated Surface Area">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3zM3 9h18M9 21V3"/></svg>
                                <span className="font-bold text-black">{Math.round(estimatedArea).toLocaleString()}</span> m² SKIN
                            </div>
                        )}
                        {floorArea !== null && (
                             <div className="flex items-center gap-1.5 text-[10px] font-mono bg-gray-50 border border-gray-200 px-2 py-1 rounded-sm text-gray-600" title="Gross Floor Area">
                                <IconLayers />
                                <span className="font-bold text-black">{Math.round(floorArea).toLocaleString()}</span> m² GFA
                             </div>
                        )}
                     </div>
                 </div>
                 
                 <div className="space-y-6">
                    {/* Slider Group */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase font-mono">Scale Factor</label>
                            <span className="text-[10px] font-mono bg-gray-100 px-1">{parametricParams.scale.toFixed(1)}</span>
                        </div>
                        <input 
                            type="range" min="0.2" max="5.0" step="0.1" 
                            value={parametricParams.scale}
                            onChange={e => setParametricParams(p => ({...p, scale: parseFloat(e.target.value)}))}
                            className="w-full"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase font-mono">Amplitude</label>
                            <span className="text-[10px] font-mono bg-gray-100 px-1">{parametricParams.height.toFixed(1)}</span>
                        </div>
                        <input 
                            type="range" min="0.2" max="10.0" step="0.1" 
                            value={parametricParams.height}
                            onChange={e => setParametricParams(p => ({...p, height: parseFloat(e.target.value)}))}
                            className="w-full"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold uppercase font-mono">Subdivision</label>
                            <span className="text-[10px] font-mono bg-gray-100 px-1">{parametricParams.levels}</span>
                        </div>
                        <input 
                            type="range" min="5" max="75" step="1" 
                            value={parametricParams.levels}
                            onChange={e => setParametricParams(p => ({...p, levels: parseInt(e.target.value)}))}
                            className="w-full"
                        />
                    </div>

                    {/* Lighting Controls */}
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                        <label className="text-[10px] font-bold uppercase font-mono">Lighting Preset</label>
                        <div className="relative">
                            <select 
                                value={lightingPreset}
                                onChange={(e) => setLightingPreset(e.target.value)}
                                className="w-full h-10 pl-3 pr-8 bg-gray-50 border border-gray-200 text-xs font-mono focus:border-black focus:outline-none appearance-none cursor-pointer hover:bg-gray-100 transition-colors"
                            >
                                {LIGHTING_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                             <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="6 9 12 15 18 9"></polyline></svg>
                             </div>
                        </div>
                    </div>
                    
                    {/* Fog Controls */}
                    <div className="pt-2 border-t border-gray-100 space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] font-bold uppercase font-mono">Atmosphere (Fog)</label>
                            <input 
                                type="color" 
                                value={fogColor} 
                                onChange={(e) => setFogColor(e.target.value)} 
                                className="h-5 w-6 border-0 p-0 cursor-pointer bg-transparent" 
                                title="Fog Color"
                            />
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between items-end">
                                <span className="text-[10px] font-mono text-gray-500">Density</span>
                                <span className="text-[10px] font-mono bg-gray-100 px-1">{fogDensity.toFixed(3)}</span>
                            </div>
                            <input
                                type="range" min="0" max="0.1" step="0.001"
                                value={fogDensity}
                                onChange={(e) => setFogDensity(parseFloat(e.target.value))}
                                className="w-full"
                            />
                        </div>
                    </div>
                 </div>
            </section>

            {/* Footer Actions */}
            <div className="mt-auto pt-6 flex gap-2">
                 {imageData && (
                     <button
                        onClick={handleGenerateModel}
                        disabled={isLoading}
                        className={`flex-1 h-12 border-2 font-bold uppercase text-[10px] tracking-wider transition-all
                            ${sceneCode ? 'border-gray-200 bg-white text-black hover:border-black' : 'border-black bg-black text-white hover:bg-gray-800'}
                        `}
                     >
                        {sceneCode ? 'Regenerate Geometry' : 'Generate 3D Model'}
                     </button>
                 )}
                 
                 {/* New Realistic Render Button */}
                 {sceneCode && viewMode === 'model' && (
                     <button
                         onClick={handleOpenRenderModal}
                         disabled={isLoading}
                         className="w-12 h-12 border border-gray-200 flex items-center justify-center hover:border-black hover:bg-gray-50 transition-colors text-gray-600 hover:text-black bg-white"
                         title="Create Realistic Render"
                     >
                         <IconCamera />
                     </button>
                 )}
                 
                 {/* Export OBJ Button */}
                 {sceneCode && viewMode === 'model' && (
                    <button
                        onClick={handleExportOBJ}
                        disabled={isLoading}
                        className="w-12 h-12 border border-gray-200 flex items-center justify-center hover:border-black hover:bg-gray-50 transition-colors text-gray-600 hover:text-black"
                        title="Export 3D Model (.obj)"
                    >
                        <span className="text-[8px] font-black">OBJ</span>
                    </button>
                 )}

                 {/* Share Button */}
                 <button
                    onClick={handleShare}
                    className="w-12 h-12 border border-gray-200 flex items-center justify-center hover:border-black hover:bg-gray-50 transition-colors text-gray-600 hover:text-black"
                    title="Share Parameters (Copy Link)"
                 >
                    <IconShare />
                 </button>

                 <button
                    onClick={handleDownload}
                    disabled={!imageData && !sceneCode}
                    className="w-12 h-12 border border-gray-200 flex items-center justify-center hover:border-black hover:bg-gray-50 transition-colors text-gray-600 hover:text-black"
                    title={viewMode === 'model' ? "Save Project (HTML)" : "Download Image"}
                 >
                    <IconDownload />
                 </button>
            </div>
         </div>
      </div>

      {/* === MAIN VIEWPORT === */}
      <div className="flex-1 relative bg-[#f0f0f0] flex flex-col overflow-hidden">
         
         {/* Notifications */}
         {showCopiedToast && (
            <div className="absolute top-20 right-4 z-50 bg-black text-white px-4 py-2 text-xs font-mono shadow-lg rounded-sm animate-bounce">
                LINK COPIED TO CLIPBOARD
            </div>
         )}

         {/* Error Toast */}
         {errorMsg && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-600 px-4 py-3 text-xs font-mono shadow-lg flex items-center gap-3">
                <span className="block w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                {errorMsg}
            </div>
         )}

         {/* Viewport Content Area - Full Bleed */}
         <div className="flex-1 w-full h-full relative bg-gray-100">
                
                {/* Empty State - Technical Grid Background */}
                {!imageData && !sceneCode && !isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 select-none overflow-hidden">
                         {/* CSS Grid Pattern */}
                         <div className="absolute inset-0 opacity-[0.03]" 
                              style={{ 
                                backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', 
                                backgroundSize: '40px 40px' 
                              }}>
                         </div>
                    </div>
                )}

                {/* Content */}
                {imageData && viewMode === 'image' && (
                    <img src={imageData} alt="Concept" className="w-full h-full object-contain p-4" />
                )}

                {sceneCode && viewMode === 'model' && (
                    <iframe
                        ref={iframeRef}
                        title="Parametric Scene"
                        srcDoc={sceneCode}
                        onLoad={handleIframeLoad}
                        className="w-full h-full border-0 block"
                        sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                )}

                {/* Processing Overlay (Glassmorphism) */}
                {isLoading && (
                    <div className="absolute inset-0 z-40 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center p-10">
                        <div className="w-full max-w-md space-y-6">
                            <div className="flex items-center justify-between font-mono text-xs uppercase">
                                <span className="font-bold tracking-wider">Processing Job</span>
                                <span className="animate-pulse">{status === 'generating_image' ? 'Diffusion' : 'Tesselation'}</span>
                            </div>
                            
                            {/* Progress Bar */}
                            <div className="w-full h-1 bg-gray-200 overflow-hidden relative">
                                <div className="absolute inset-0 bg-black w-1/3 animate-[scanline_2s_linear_infinite] translate-x-[-100%]"></div>
                                <div className="absolute inset-y-0 left-0 bg-black w-full origin-left animate-[progress_20s_cubic-bezier(0.4,0,0.2,1)_infinite]"></div>
                            </div>
                            <style>{`@keyframes progress { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }`}</style>

                            {/* Terminal Output */}
                            <div 
                                ref={terminalRef}
                                className="w-full h-32 bg-black text-green-500 font-mono text-[10px] p-3 overflow-y-auto rounded-sm leading-relaxed shadow-inner"
                            >
                                <p className="opacity-50">&gt; System initialized</p>
                                <p className="opacity-50">&gt; Context: User Workspace</p>
                                {thinkingText && (
                                    <>
                                        <p className="text-white mt-2 border-t border-gray-800 pt-2 mb-1 font-bold">&gt; {thinkingText}</p>
                                        <p className="animate-pulse">...</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Source Watermark (when viewing image) */}
                {viewMode === 'image' && imageData && (
                    <div className="absolute bottom-4 left-4 bg-black/5 text-black/30 px-2 py-1 text-[8px] font-mono uppercase pointer-events-none rounded-sm backdrop-blur-sm">
                        RAW INPUT
                    </div>
                )}
         </div>
         
         {/* Bottom Status Bar */}
         <div className="h-8 bg-white border-t border-gray-200 flex items-center justify-between px-4 text-[10px] font-mono text-gray-400 select-none z-20 relative">
             <div className="flex gap-4">
                 <span>STATUS: {status === 'idle' ? 'READY' : 'BUSY'}</span>
                 <span>ZOOM: 100%</span>
             </div>
             <div>
                 GENAI / GEMINI 2.5 FLASH / 3.0 PREVIEW
             </div>
         </div>
      </div>

      {/* === RENDER MODAL === */}
      {renderModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/50 backdrop-blur-sm">
              <div className="bg-white w-full max-w-5xl h-full max-h-[90vh] shadow-2xl flex flex-col md:flex-row overflow-hidden rounded-sm">
                  
                  {/* Left: Preview / Controls */}
                  <div className="w-full md:w-1/3 p-6 bg-gray-50 border-r border-gray-200 flex flex-col gap-6">
                      <div className="flex items-center justify-between">
                          <h2 className="text-sm font-bold uppercase tracking-wider">Render Configuration</h2>
                          <button onClick={() => setRenderModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-sm"><IconX /></button>
                      </div>

                      <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
                          {/* Source Screenshot */}
                          <div className="space-y-2">
                             <label className="text-[10px] font-mono uppercase text-gray-400">Source Geometry</label>
                             <div className="w-full aspect-square bg-white border border-gray-200 p-2 flex items-center justify-center">
                                 {screenshot && <img src={screenshot} className="max-w-full max-h-full object-contain" alt="3D Screenshot" />}
                             </div>
                          </div>

                          {/* Prompt Input */}
                          <div className="space-y-2 flex-1">
                             <label className="text-[10px] font-mono uppercase text-gray-400">Environment & Style Prompt</label>
                             <textarea 
                                value={renderPrompt}
                                onChange={(e) => setRenderPrompt(e.target.value)}
                                className="w-full h-40 p-3 border border-gray-200 bg-white text-sm resize-none focus:border-black focus:outline-none"
                                placeholder="Describe the context, lighting, and materials..."
                             />
                          </div>
                      </div>

                      <button
                          onClick={handleGenerateRender}
                          disabled={isRendering}
                          className="w-full h-12 bg-black text-white font-bold uppercase tracking-widest text-xs hover:bg-gray-900 disabled:opacity-50 transition-all"
                      >
                          {isRendering ? 'Rendering...' : 'Generate Render'}
                      </button>
                  </div>

                  {/* Right: Result */}
                  <div className="flex-1 bg-black relative flex flex-col">
                       <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
                           {isRendering && (
                               <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50 backdrop-blur-sm">
                                   <div className="text-white font-mono text-xs animate-pulse">PROCESSING HIGH FIDELITY RENDER...</div>
                               </div>
                           )}
                           
                           {!renderedImage ? (
                               <div className="text-gray-700 font-mono text-xs uppercase tracking-widest text-center">
                                   <p>Awaiting Render</p>
                                   <p className="text-gray-800 mt-2 text-[10px]">Configure prompt and click generate</p>
                               </div>
                           ) : (
                               <img src={renderedImage} className="max-w-full max-h-full object-contain shadow-2xl" alt="Realistic Render" />
                           )}
                       </div>

                       {renderedImage && (
                           <div className="h-16 border-t border-gray-800 bg-gray-900 p-4 flex justify-end gap-4">
                               <button 
                                   onClick={handleDownloadRender}
                                   className="h-full px-6 bg-white text-black font-bold uppercase text-xs tracking-wider hover:bg-gray-200"
                               >
                                   Download High Res
                               </button>
                           </div>
                       )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default App;
