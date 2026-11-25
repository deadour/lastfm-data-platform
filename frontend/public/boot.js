// if the app bundle never loads, replace "cargando…" with something useful.
// react removes this element when it mounts, so the timer then does nothing.
window.setTimeout(function () {
  var status = document.getElementById("boot-status");
  if (status) status.textContent = "no se pudo cargar la página. probá recargar en un rato.";
}, 8000);
