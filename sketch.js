// ======== layout helpers ========
function getCanvasSize() {
  const wrap = document.getElementById('canvasWrap');
  const cs = getComputedStyle(wrap);
  const w = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  return { w: Math.max(320, w), h: Math.max(240, h) };
}
function fitRect(srcW, srcH, dstW, dstH){ const s=Math.min(dstW/srcW,dstH/srcH); const w=Math.round(srcW*s),h=Math.round(srcH*s); const x=Math.floor((dstW-w)/2),y=Math.floor((dstH-h)/2); return {x,y,w,h}; }
function coverRect(srcW, srcH, dstW, dstH){ const s=Math.max(dstW/srcW,dstH/srcH); const w=Math.round(srcW*s),h=Math.round(srcH*s); const x=Math.floor((dstW-w)/2),y=Math.floor((dstH-h)/2); return {x,y,w,h}; }
function layoutFileToCanvas(srcW, srcH, spaceW, spaceH, mode='fitHeight'){
  const ar = srcW / srcH; let canvasW=spaceW, canvasH=spaceH, box={x:0,y:0,w:spaceW,h:spaceH};
  if (mode==='fitHeight'){ canvasH=spaceH; canvasW=Math.round(spaceH*ar); if(canvasW>spaceW){ const f=fitRect(srcW,srcH,spaceW,spaceH); canvasW=f.w; canvasH=f.h; } box={x:0,y:0,w:canvasW,h:canvasH}; }
  else if (mode==='fitWidth'){ canvasW=spaceW; canvasH=Math.round(spaceW/ar); if(canvasH>spaceH){ const f=fitRect(srcW,srcH,spaceW,spaceH); canvasW=f.w; canvasH=f.h; } box={x:0,y:0,w:canvasW,h:canvasH}; }
  else if (mode==='fit'){ const f=fitRect(srcW,srcH,spaceW,spaceH); canvasW=f.w; canvasH=f.h; box={x:0,y:0,w:f.w,h:f.h}; }
  else if (mode==='cover'){ canvasW=spaceW; canvasH=spaceH; box=coverRect(srcW,srcH,spaceW,spaceH); }
  return { canvasW, canvasH, box };
}
function hasFrame(media){ return media && media.elt && media.elt.readyState >= 2; }
function nowStamp(){ const d=new Date(); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`; }

// ======== state ========
let srcType = 'webcam';   // 'webcam' | 'image' | 'video'
let cam, vid, img, camReady = false;
let canvasW, canvasH;
let ui = {};
let mats = {}; let cvGuard = false;
let pg; // off-screen buffer
let drawBoxWeb={x:0,y:0,w:0,h:0}, drawBoxFile={x:0,y:0,w:0,h:0};
let camNativeW=640, camNativeH=480;
const FILE_LAYOUT_MODE = 'fitHeight'; // 'fitHeight' | 'fitWidth' | 'fit' | 'cover'

// Export state
let rec, recChunks=[], recStream=null;

// ======== setup ========
function setup(){
  const size = getCanvasSize();
  canvasW = size.w; canvasH = size.h;
  const c = createCanvas(canvasW, canvasH);
  c.parent('canvasWrap'); c.id('p5canvas');

  // Retina-friendly senza esagerare
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));

  colorMode(HSB,360,100,100,255);
  pg = createGraphics(canvasW, canvasH);
  document.getElementById('p5canvas').getContext('2d', { willReadFrequently: true });
  pg.elt.getContext('2d', { willReadFrequently: true });

  bindUI();
  startWebcam();

  window.addEventListener('beforeunload', () => {
    if (mats.gray) mats.gray.delete();
    if (mats.tmp)  mats.tmp.delete();
    cleanupMedia();
  });
}

// ======== UI ========
function bindUI(){
  const $ = s => select(s);
  // sorgente
  $('#btnWebcam').mousePressed(startWebcam);
  $('#fileImg').elt.addEventListener('change', handleImage);
  $('#fileVid').elt.addEventListener('change', handleVideo);

  // detect
  ui.method=$('#method'); ui.blur=$('#blur'); ui.thresh=$('#thresh');
  ui.cannyL=$('#cannyL'); ui.cannyH=$('#cannyH'); ui.approx=$('#approx'); ui.features=$('#features');
  ui.minArea=$('#minArea'); ui.maxStroke=$('#maxStroke');
  ui.minArea.elt.addEventListener('input',()=>$('#minAreaVal').html(ui.minArea.value()));
  ui.maxStroke.elt.addEventListener('input',()=>$('#maxStrokeVal').html(ui.maxStroke.value()));
  ui.method.changed(()=>{ const m=ui.method.value(); document.getElementById('thLabel').style.display=(m==='threshold')?'':'none'; document.getElementById('cxLabel').style.display=(m==='canny')?'':'none'; document.getElementById('cyLabel').style.display=(m==='canny')?'':'none'; });

  // stile
  ui.useColormap=$('#useColormap'); ui.colormap=$('#colormap'); ui.fixedColor=$('#fixedColor'); ui.strokeAlpha=$('#strokeAlpha');

  // colori UI
  ui.boxColor=$('#boxColor'); ui.centroidColor=$('#centroidColor'); ui.labelLineColor=$('#labelLineColor'); ui.labelTextColor=$('#labelTextColor'); ui.labelBg=$('#labelBg');

  // labels
  ui.labels=$('#labels'); ui.labelMetric=$('#labelMetric'); ui.labelStep=$('#labelStep'); ui.curvWin=$('#curvWin'); ui.labelTemplate=$('#labelTemplate'); ui.decimals=$('#decimals'); ui.fontSize=$('#fontSize');
  $('#curvWin').elt.addEventListener('input',()=>$('#curvWinVal').html(ui.curvWin.value()));
  $('#labelStep').elt.addEventListener('input',()=>$('#labelStepVal').html(ui.labelStep.value()));
  $('#decimals').elt.addEventListener('input',()=>$('#decimalsVal').html(ui.decimals.value()));
  $('#fontSize').elt.addEventListener('input',()=>$('#fontSizeVal').html(ui.fontSize.value()));
  const refresh = ()=>{ const isPoint=ui.labelMetric.value()!=='area'; ui.labelStep.elt.disabled=!isPoint; ui.curvWin.elt.disabled=!(isPoint && ui.labelMetric.value()==='curv'); document.getElementById('curvWinLabel').style.opacity=(ui.labelMetric.value()==='curv')?1:0.5; };
  ui.labelMetric.changed(refresh); refresh();

  // export
  ui.pngScale = $('#pngScale'); ui.overlayOnly = $('#overlayOnly'); $('#btnPng').mousePressed(exportPNG);
  ui.seqSeconds = $('#seqSeconds'); ui.seqFps = $('#seqFps'); ui.seqScale = $('#seqScale'); ui.seqOverlayOnly = $('#seqOverlayOnly'); $('#btnSeq').mousePressed(exportSequence);
  ui.webmFps = $('#webmFps'); $('#btnWebmStart').mousePressed(startWebM); $('#btnWebmStop').mousePressed(stopWebM);
}

// ======== sources ========
function startWebcam(){
  cleanupMedia(); srcType='webcam'; camReady=false;

  cam = createCapture({ video:{ facingMode:'user' }, audio:false }, ()=>{
    cam.elt.setAttribute('playsinline',''); cam.elt.muted=true; cam.elt.autoplay=true;

    const onReady = () => {
      if (!hasFrame(cam)) return;
      try { cam.elt.play(); } catch(_) {}
      camReady = true;
      camNativeW = cam.elt.videoWidth; camNativeH = cam.elt.videoHeight;
      const {w,h}=getCanvasSize();
      resizeCanvas(w,h); pg.resizeCanvas(w,h);
      drawBoxWeb = coverRect(camNativeW, camNativeH, w, h);
      document.getElementById('infoSource').textContent = `Sorgente: Webcam (${camNativeW}×${camNativeH})`;
    };

    cam.elt.onloadedmetadata = onReady;
    cam.elt.onloadeddata     = onReady;
    cam.elt.onplaying        = onReady;
    const tick=setInterval(()=>{ if(hasFrame(cam)){ clearInterval(tick); onReady(); }},200);
    setTimeout(()=>clearInterval(tick),4000);
  });
  cam.hide();
}

function handleImage(e){
  cleanupMedia(); srcType='image';
  const f=e.target.files[0]; if(!f) return;
  const url=URL.createObjectURL(f);
  loadImage(url,(loaded)=>{
    img=loaded;
    const {w:spaceW,h:spaceH}=getCanvasSize();
    const L = layoutFileToCanvas(img.width, img.height, spaceW, spaceH, FILE_LAYOUT_MODE);
    resizeCanvas(L.canvasW, L.canvasH); pg.resizeCanvas(L.canvasW, L.canvasH);
    drawBoxFile = {x:L.box.x, y:L.box.y, w:L.box.w, h:L.box.h};
    document.getElementById('infoSource').textContent=`Sorgente: Immagine (${img.width}×${img.height} → ${L.canvasW}×${L.canvasH})`;
  });
}

function handleVideo(e){
  cleanupMedia(); srcType='video';
  const f=e.target.files[0]; if(!f) return;
  const url=URL.createObjectURL(f);
  vid = createVideo(url); vid.hide();

  const onReady = () => {
    if (!hasFrame(vid)) return;
    vid.volume(0); vid.loop(); vid.elt.setAttribute('playsinline',''); try{ vid.play(); }catch(_){}
    const vw=vid.elt.videoWidth, vh=vid.elt.videoHeight;
    const {w:spaceW,h:spaceH}=getCanvasSize();
    const L = layoutFileToCanvas(vw, vh, spaceW, spaceH, FILE_LAYOUT_MODE);
    resizeCanvas(L.canvasW, L.canvasH); pg.resizeCanvas(L.canvasW, L.canvasH);
    drawBoxFile = {x:L.box.x, y:L.box.y, w:L.box.w, h:L.box.h};
    document.getElementById('infoSource').textContent=`Sorgente: Video (${vw}×${vh} → ${L.canvasW}×${L.canvasH})`;
  };
  vid.elt.onloadedmetadata = onReady;
  vid.elt.onloadeddata     = onReady;
  vid.elt.onplaying        = onReady;
  const tick=setInterval(()=>{ if(hasFrame(vid)){ clearInterval(tick); onReady(); }},200);
  setTimeout(()=>clearInterval(tick),4000);
}

function cleanupMedia(){ if(cam){ cam.remove(); cam=null; } if(vid){ vid.remove(); vid=null; } img=null; camReady=false; }

// ======== resize ========
function windowResized(){
  const {w:spaceW,h:spaceH}=getCanvasSize();
  if (srcType==='webcam'){
    resizeCanvas(spaceW, spaceH); pg.resizeCanvas(spaceW, spaceH);
    drawBoxWeb = coverRect(camNativeW, camNativeH, spaceW, spaceH);
  } else if (srcType==='image' && img){
    const L = layoutFileToCanvas(img.width, img.height, spaceW, spaceH, FILE_LAYOUT_MODE);
    resizeCanvas(L.canvasW,L.canvasH); pg.resizeCanvas(L.canvasW,L.canvasH); drawBoxFile={x:L.box.x,y:L.box.y,w:L.box.w,h:L.box.h};
  } else if (srcType==='video' && hasFrame(vid)){
    const vw=vid.elt.videoWidth, vh=vid.elt.videoHeight;
    const L = layoutFileToCanvas(vw, vh, spaceW, spaceH, FILE_LAYOUT_MODE);
    resizeCanvas(L.canvasW,L.canvasH); pg.resizeCanvas(L.canvasW,L.canvasH); drawBoxFile={x:L.box.x,y:L.box.y,w:L.box.w,h:L.box.h};
  }
}

// ======== draw ========
function draw(){
  background(12);
  if (!cvReady) { push(); fill(200); textAlign(CENTER); textSize(16); text('Caricamento OpenCV…', width/2, height/2); pop(); return; }

  // 1) draw source on screen + pg
  pg.clear();
  let drawn=false;
  if (srcType==='webcam' && hasFrame(cam)){
    image(cam, drawBoxWeb.x, drawBoxWeb.y, drawBoxWeb.w, drawBoxWeb.h);
    pg.image(cam, drawBoxWeb.x, drawBoxWeb.y, drawBoxWeb.w, drawBoxWeb.h);
    drawn=true;
  } else if (srcType==='video' && hasFrame(vid)){
    image(vid, drawBoxFile.x, drawBoxFile.y, drawBoxFile.w, drawBoxFile.h);
    pg.image(vid, drawBoxFile.x, drawBoxFile.y, drawBoxFile.w, drawBoxFile.h);
    drawn=true;
  } else if (srcType==='image' && img){
    image(img, drawBoxFile.x, drawBoxFile.y, drawBoxFile.w, drawBoxFile.h);
    pg.image(img, drawBoxFile.x, drawBoxFile.y, drawBoxFile.w, drawBoxFile.h);
    drawn=true;
  }
  if(!drawn){ push(); stroke(40); noFill(); rect(10,10,width-20,height-20); fill(120); textAlign(CENTER); text('Nessuna sorgente attiva', width/2, height/2); pop(); return; }

  document.getElementById('infoFps').textContent = `FPS: ${nf(frameRate(),2,1)}`;

  // 2) OpenCV overlay
  if (cvGuard) return; cvGuard=true;
  if(!mats.gray){ mats.gray=new cv.Mat(height,width,cv.CV_8UC1); mats.tmp=new cv.Mat(height,width,cv.CV_8UC1); }
  let src=null, conts=null, hier=null;
  try{
    src = cv.imread(pg.elt);
    cv.cvtColor(src, mats.gray, cv.COLOR_RGBA2GRAY);
    const blurK = int(ui.blur.value()); if (blurK>0){ const k=blurK%2?blurK:blurK+1; cv.GaussianBlur(mats.gray,mats.gray,new cv.Size(k,k),0,0); }
    if (ui.method.value()==='threshold'){ cv.threshold(mats.gray, mats.tmp, int(ui.thresh.value()), 255, cv.THRESH_BINARY); }
    else { cv.Canny(mats.gray, mats.tmp, int(ui.cannyL.value()), int(ui.cannyH.value())); }
    const kernel=cv.Mat.ones(3,3,cv.CV_8U); cv.dilate(mats.tmp,mats.tmp,kernel); kernel.delete();

    conts=new cv.MatVector(); hier=new cv.Mat();
    cv.findContours(mats.tmp, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    const minA=int(ui.minArea.value()), maxStroke=int(ui.maxStroke.value());
    // stima area max
    let maxA=0;
    for(let i=0;i<conts.size();i++){ const c=conts.get(i); const a=Math.abs(cv.contourArea(c,false)); c.delete(); if(a>=minA && a>maxA) maxA=a; }
    if(maxA===0){ /* niente */ }
    else{
      // ricalcola contorni (quelli sopra li ho liberati)
      conts.delete(); hier.delete(); conts=new cv.MatVector(); hier=new cv.Mat();
      cv.findContours(mats.tmp, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

      for(let i=0;i<conts.size();i++){
        let cnt=conts.get(i); let area=Math.abs(cv.contourArea(cnt,false));
        if(area<minA){ cnt.delete(); continue; }

        let toDraw=cnt, usedApprox=false;
        if(ui.approx.elt.checked){ const peri=cv.arcLength(cnt,true); const approx=new cv.Mat(); cv.approxPolyDP(cnt,approx,0.01*peri,true); toDraw=approx; usedApprox=true; }

        const sw=map(area,minA,maxA,1,maxStroke,true); strokeWeight(sw);
        let col;
        if(ui.useColormap.elt.checked){ const t=map(area,minA,maxA,0,1,true); col=sampleColormap(ui.colormap.value(),t,int(ui.strokeAlpha.value())); }
        else { push(); colorMode(RGB,255); col=color(ui.fixedColor.value()); col.setAlpha(int(ui.strokeAlpha.value())); pop(); }
        stroke(col); noFill();

        beginShape();
        for(let j=0;j<toDraw.data32S.length;j+=2) curveVertex(toDraw.data32S[j], toDraw.data32S[j+1]);
        endShape(CLOSE);

        const M=cv.moments(toDraw,false); const cx=M.m10/(M.m00||1), cy=M.m01/(M.m00||1);
        if(ui.features.elt.checked && toDraw.data32S.length>=4){
          const rect=cv.boundingRect(toDraw);
          push(); colorMode(RGB,255); noFill(); stroke(ui.boxColor.value()); p5.prototype.rect.call(this, rect.x, rect.y, rect.width, rect.height); pop();
          push(); colorMode(RGB,255); noStroke(); fill(ui.centroidColor.value()); circle(cx,cy,constrain(sw+3,4,12)); pop();
        }
        if(ui.labels.elt.checked){ drawMetricLabels(toDraw,{cx,cy,area},col); }
        if(usedApprox) toDraw.delete();
        cnt.delete();
      }
    }
  }catch(e){ /* console.log(e); */ }
  finally{ if(src)src.delete(); if(conts)conts.delete(); if(hier)hier.delete(); cvGuard=false; }
}

// ======== colormap ========
function sampleColormap(name,t,alpha=220){
  t=constrain(t,0,1);
  if(name==='bluered'){ const hue=lerp(220,0,t); return color(hue,90,100,alpha); }
  const viridis=['#440154','#46327e','#365c8d','#277f8e','#1fa187','#4ac16d','#a0da39','#fde725'];
  const plasma=['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#eff821'];
  const A=(name==='viridis')?viridis:plasma; const idx=t*(A.length-1),i0=floor(idx),i1=min(i0+1,A.length-1),tt=idx-i0;
  push(); colorMode(RGB,255); const c=lerpColor(color(A[i0]), color(A[i1]), tt); c.setAlpha(alpha); pop(); return c;
}

// ======== labels & metrics ========
function drawMetricLabels(contourMat, blobInfo, baseColor){
  const metric=ui.labelMetric.value(); const dec=int(ui.decimals.value()); const fsize=int(ui.fontSize.value()||16);
  const lineCol=ui.labelLineColor.value(); const textCol=ui.labelTextColor.value(); const showBg=ui.labelBg.elt.checked;
  if(metric==='area'){ const {cx,cy,area}=blobInfo; const lx=constrain(cx+40,8,width-8); const ly=constrain(cy-30,18,height-8); drawLabelWithLeader(cx,cy,lx,ly,formatTemplate({area},dec),lineCol,textCol,fsize,showBg); return; }
  const step=int(ui.labelStep.value()); const n=contourMat.data32S.length/2; if(n<2) return;
  const pts=new Array(n); for(let i=0,k=0;i<n;i++,k+=2) pts[i]={x:contourMat.data32S[k], y:contourMat.data32S[k+1]};
  const {cx,cy}=blobInfo; const cw=int(ui.curvWin.value());
  for(let i=0;i<n;i+=step){
    const p=pts[i]; let v={x:p.x,y:p.y,index:i};
    if(metric==='dist' || ui.labelTemplate.value().includes('{dist}')) v.dist=Math.hypot(p.x-cx,p.y-cy);
    if(metric==='curv' || ui.labelTemplate.value().includes('{curv}')){
      const prev=pts[(i-cw+n)%n], next=pts[(i+cw)%n];
      const a1=Math.atan2(p.y-prev.y,p.x-prev.x), a2=Math.atan2(next.y-p.y,next.x-p.x);
      let d=a2-a1; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
      const len=((p.x-prev.x)**2+(p.y-prev.y)**2 + (next.x-p.x)**2+(next.y-p.y)**2)/2; v.curv=Math.abs(d)/Math.max(1,Math.sqrt(len));
    }
    const lx=constrain(p.x+40,8,width-8), ly=constrain(p.y-30,18,height-8);
    drawLabelWithLeader(p.x,p.y,lx,ly,formatTemplate(v,dec),lineCol,textCol,fsize,showBg,baseColor);
  }
}
function drawLabelWithLeader(x,y,lx,ly,txt,lineCol,textCol,fontSize=16,bg=false,dotCol=null){
  push(); stroke(lineCol); dashedLine(x,y,lx,ly,6,4); pop();
  push(); noStroke(); fill(dotCol||lineCol); circle(x,y,4); pop();
  push(); textSize(fontSize); textAlign(LEFT,CENTER); noStroke(); fill(textCol);
  if(bg){ const pad=4,w=textWidth(txt)+pad*2,h=fontSize+pad*1.2; fill(0,150); rect(lx-pad,ly-h/2,w,h,6); fill(textCol); }
  text(txt,lx,ly); pop();
}
function formatTemplate(v,dec){
  const tpl=(ui.labelTemplate.value()||defaultTemplateForMetric()); const fmt=n=>(typeof n==='number'?nf(n,1,dec):n);
  return tpl.replaceAll('{x}',fmt(v.x)).replaceAll('{y}',fmt(v.y)).replaceAll('{index}',fmt(v.index))
            .replaceAll('{dist}',fmt(v.dist)).replaceAll('{curv}',fmt(v.curv)).replaceAll('{area}',fmt(v.area));
}
function defaultTemplateForMetric(){ switch(ui.labelMetric.value()){ case 'coords':return '{x}, {y}'; case 'index':return '{index}'; case 'dist':return '{dist}'; case 'curv':return '{curv}'; case 'area':return '{area}'; default:return '{x}, {y}'; } }
function dashedLine(x1,y1,x2,y2,d=6,g=4){ const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy); if(L<1)return; const ux=dx/L,uy=dy/L; let t=0; while(t<L){ const nx=Math.min(t+d,L); line(x1+ux*t,y1+uy*t,x1+ux*nx,y1+uy*nx); t+=d+g; } }

// ========================= EXPORT =========================

// Renders overlays on current canvas; if withSource=false, non ridisegna la sorgente (PNG trasparente)
function renderOnce(withSource=true){
  clear();
  if (withSource){
    if (srcType==='webcam' && hasFrame(cam)) image(cam, drawBoxWeb.x, drawBoxWeb.y, drawBoxWeb.w, drawBoxWeb.h);
    else if (srcType==='video' && hasFrame(vid)) image(vid, drawBoxFile.x, drawBoxFile.y, drawBoxFile.w, drawBoxFile.h);
    else if (srcType==='image' && img) image(img, drawBoxFile.x, drawBoxFile.y, drawBoxFile.h, drawBoxFile.h);
  }
}

// ---- PNG singolo ----
function exportPNG(){
  const scale = parseInt(ui.pngScale.value());
  const overlayOnly = ui.overlayOnly.elt.checked;

  const temp = document.createElement('canvas');
  temp.width = width * scale;
  temp.height = height * scale;
  const tctx = temp.getContext('2d');

  const backup = document.createElement('canvas');
  backup.width = width; backup.height = height;
  backup.getContext('2d').drawImage(document.getElementById('p5canvas'), 0, 0);

  if (overlayOnly){ clear(); }

  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(document.getElementById('p5canvas'), 0, 0, temp.width, temp.height);

  if (overlayOnly){
    const ctx = document.getElementById('p5canvas').getContext('2d');
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(backup,0,0);
  }

  temp.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download=`blobtrack_${nowStamp()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

// ---- SEQUENZA PNG ZIP ----
async function exportSequence(){
  const secs = Math.max(1, parseInt(ui.seqSeconds.value()));
  const fps  = Math.min(60, Math.max(1, parseInt(ui.seqFps.value())));
  const scale= Math.max(1, parseInt(ui.seqScale.value()));
  const overlayOnly = ui.seqOverlayOnly.elt.checked;

  const frames = secs * fps;
  const zip = new JSZip();

  const temp = document.createElement('canvas');
  temp.width = width * scale; temp.height = height * scale;
  const tctx = temp.getContext('2d');

  const backup = document.createElement('canvas');
  backup.width = width; backup.height = height;

  let i=0;
  const interval = 1000 / fps;

  const grab = () => new Promise(resolve=>{
    const bctx=backup.getContext('2d');
    bctx.clearRect(0,0,width,height);
    bctx.drawImage(document.getElementById('p5canvas'),0,0);

    if (overlayOnly){ clear(); }

    tctx.clearRect(0,0,temp.width,temp.height);
    tctx.drawImage(document.getElementById('p5canvas'),0,0,temp.width,temp.height);

    if (overlayOnly){
      const ctx=document.getElementById('p5canvas').getContext('2d');
      ctx.clearRect(0,0,width,height);
      ctx.drawImage(backup,0,0);
    }

    temp.toBlob(b=>{
      const fname=`frame_${String(i).padStart(5,'0')}.png`;
      zip.file(fname, b);
      resolve();
    }, 'image/png');
  });

  for (; i<frames; i++){
    await new Promise(r=>setTimeout(r, interval));
    await grab();
  }

  const blob = await zip.generateAsync({type:'blob'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`blobtrack_seq_${nowStamp()}_${fps}fps_${secs}s.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Video WebM ----
function startWebM(){
  if (rec) return;
  const fps = Math.min(60, Math.max(5, parseInt(ui.webmFps.value())));
  const canvas = document.getElementById('p5canvas');
  recStream = canvas.captureStream(fps);
  recChunks = [];
  rec = new MediaRecorder(recStream, { mimeType: 'video/webm; codecs=vp9' });
  rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(recChunks, {type:'video/webm'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`blobtrack_${nowStamp()}_${fps}fps.webm`;
    a.click();
    URL.revokeObjectURL(a.href);
    rec=null; recStream.getTracks().forEach(t=>t.stop()); recStream=null; recChunks=[];
    select('#btnWebmStart').removeAttribute('disabled');
    select('#btnWebmStop').attribute('disabled', true);
  };
  rec.start();
  select('#btnWebmStart').attribute('disabled', true);
  select('#btnWebmStop').removeAttribute('disabled');
}
function stopWebM(){ if(rec){ rec.stop(); } }
