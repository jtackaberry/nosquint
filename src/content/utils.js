/* Returns a list of lines from a URL (such as chrome://).  This function
 * is a WTF; how more obsure could it possibly be to read a damn file?
 */
function readLines(aURL) {
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                  .getService(Components.interfaces.nsIIOService);
  var scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                         .getService(Components.interfaces.nsIScriptableInputStream);

  var channel = ioService.newChannel(aURL, null, null);
  var input = channel.open();
  scriptableStream.init(input);
  var str = scriptableStream.read(input.available());
  scriptableStream.close();
  input.close();
  return str.split("\n");
} 

// XXX: don't forget to disable this for releases.
function debug(msg) {
//    dump("[nosquint] " + msg + "\n");
}

/* This function is called a lot, so we take some care to optimize for the
 * common cases.
 */
function is_chrome(browser) {
    var document = browser.docShell.document;
    
    if (document.URL == undefined)
        return true;

    /* In the common case, document.URL == browser.currentURI.spec, so we test
     * this simple equality first before resorting to the probably unnecessary
     * regexp call.
     */
    if (document.URL !=  browser.currentURI.spec &&
        document.URL.replace(/#.*$/, '') != browser.currentURI.spec.replace(/#.*$/, ''))
        /* Kludge: doc.URL doesn't match browser currentURI during host lookup failure,
         * SSL cert errors, or other scenarios that result in an internal page being
         * displayed that we consider chrome.
         */
        return true;

    // A couple other common cases.
    if (document.contentType == 'text/html' || document.contentType == 'application/xhtml+xml')
        return false;
    if (document.URL == undefined || document.URL.substr(0, 6) == 'about:')
        return true;

    // Less common cases that we'll cover with the more expensive regexp.
    return document.contentType.search(/^text\/(plain|css|xml|javascript)/) != 0;
}

function is_image(browser) {
    return browser.docShell.document.contentType.search(/^image\//) == 0;
}


function foreach_window(callback) {
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                       .getService(Components.interfaces.nsIWindowMediator);
    var windows = wm.getEnumerator("navigator:browser");
    var win;
    while (win = windows.getNext())
        if (callback(win) == false)
            break;
}

function popup(type, title, text, bundle) {
    if (!bundle)
        bundle = document.getElementById("nosquint-overlay-bundle");
    var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                  .getService(Components.interfaces.nsIPromptService);
    if (type == "confirm") 
        return prompts.confirmEx(window, bundle.getString(title),
                                 bundle.getString(text),
                                 prompts.STD_YES_NO_BUTTONS, null, null, null, 
                                 null, {value: null});
    else if (type == "alert")
        return prompts.alert(window, bundle.getString(title), bundle.getString(text));
    return null;
}
