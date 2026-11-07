// Εικόνες που διαλέγει ο τεχνίτης (λογότυπο, φωτογραφίες εργασίας): μικραίνουν και ξαναζωγραφίζονται στο κινητό.
// Η νέα κωδικοποίηση από canvas δεν κρατά μεταδεδομένα (EXIF, GPS, μοντέλο κινητού). Τίποτα δεν φεύγει από τη συσκευή εδώ.

/** Ρίχνει Error με ελληνικό μήνυμα αν το αρχείο δεν είναι εικόνα που ανοίγει. */
export async function fitImage(file, {max = 1280, type = 'image/jpeg', quality = 0.8} = {}){
  if(!file || !/^image\//.test(file.type || 'image/')) throw new Error('Αυτό το αρχείο δεν είναι εικόνα.');
  const bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}).catch(() => null);
  const img = bmp || await new Promise((ok, fail) => {
    const i = new Image(), url = URL.createObjectURL(file);
    i.onload = () => { URL.revokeObjectURL(url); ok(i); };
    i.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Δεν μπόρεσα να ανοίξω την εικόνα.')); };
    i.src = url;
  });
  if(!img.width || !img.height) throw new Error('Δεν μπόρεσα να ανοίξω την εικόνα.');
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const ctx = c.getContext('2d');
  if(type === 'image/jpeg'){ ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }   // διάφανα PNG → λευκό φόντο
  ctx.drawImage(img, 0, 0, c.width, c.height);
  bmp?.close?.();
  return {url: c.toDataURL(type, quality), width: c.width, height: c.height};
}
