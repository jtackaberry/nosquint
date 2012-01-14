const Cc = Components.classes;
const Ci = Components.interfaces;
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function Aboutnosquint() {}

Aboutnosquint.prototype = {
  classDescription: "about:nosquint",
  contractID: "@mozilla.org/network/protocol/about;1?what=nosquint",
  classID: Components.ID("{d0d9afd9-ef86-46fe-8a39-87c44dbce919}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),
  
  getURIFlags: function(aURI) {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },
  
  newChannel: function(aURI) {
    let ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    let channel = ios.newChannel("chrome://nosquint/content/about.html", null, null);
    channel.originalURI = aURI;
    return channel;
  }
};

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([Aboutnosquint]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([Aboutnosquint]);
