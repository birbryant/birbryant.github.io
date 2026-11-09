// Common site header. Edit the links here and every page updates.
// Links are relative to the folder header.js lives in, so this works
// from pages in subfolders too (load it with src="../header.js", etc.).
(function () {
  var links = [
    ["index.html",    "Home"],
    ["research.html", "Research"],
    ["teaching.html", "Teaching"],
    //["code.html",     "Code"],
    ["projects.html", "Student Projects"],
    ["PotW.html", "PotW"]
  ];

  // Site root = the folder containing this script.
  var root = document.currentScript.src.replace(/[^\/]*$/, "");

  // Current page's full address (treat a bare folder as its index.html).
  var here = location.href.split(/[?#]/)[0];
  if (/\/$/.test(here)) here += "index.html";

  var html = '<nav class="site-nav">';
  for (var i = 0; i < links.length; i++) {
    var url = root + links[i][0], label = links[i][1];
    var style = ' style="color:#3366FF; margin-right:0.5em;' +
                (url === here ? ' font-weight:bold;' : '') + '"';
    html += '<a href="' + url + '"' + style + '>' + label + '</a> ';
  }
  html += '</nav><hr>';

  document.getElementById("site-header").innerHTML = html;
})();
