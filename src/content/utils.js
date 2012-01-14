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

// TODO: benchmark this function, it is called a lot.
function is_chrome(browser) {
    var document = browser.docShell.document;
    debug("IS CHROME: " + document.URL + " (" + browser.currentURI.spec + ")  -- type:" + document.contentType);
    if (document.URL.replace(/#.*$/, '') != browser.currentURI.spec.replace(/#.*$/, ''))
        /* Kludge: doc.URL doesn't match browser currentURI during host lookup failure,
         * SSL cert errors, or other scenarios that result in an internal page being
         * displayed that we consider chrome.
         */
        return true;
    return document.URL == undefined || 
           document.URL.search(/^about:/) != -1 ||
           document.contentType.search(/^text\/(html|plain|css|xml|javascript)|^application\/(xhtml)/) != 0;
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

function window_get_global(name) {
    var value = null;
    foreach_window(function(win) {
        if (win._noSquintGlobals != undefined && name in win._noSquintGlobals) {
            value = win._noSquintGlobals[name];
            return false;
        }
    });
    return value;
}

function window_set_global(name, value) {
    foreach_window(function(win) {
        if (win._noSquintGlobals == undefined)
            win._noSquintGlobals = {};
        win._noSquintGlobals[name] = value;
    });
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
