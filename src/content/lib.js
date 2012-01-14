(function() {
    // Shorter alias
    this.NSQ = NoSquint;

    /* Setup global (spans all windows) storage object.  The storage object
     * exists once, and is referenced for each window.  (In contrast, doing
     * Application.storage.set('foo', [1,2]) will store a copy of the list.)
     */
    var extstorage = Application.extensions.get('nosquint@urandom.ca').storage;
    this.storage = extstorage.get('global', null);
    if (this.storage === null) {
        // Initialize global defaults.
        this.storage = {
            disabled: false,
            quitting: false,
            origSiteSpecific: null,
            dialogs: {}
        };
        extstorage.set('global', this.storage);
    }


    this.is30 = function() {
        return Application.version.substr(0, 4) == '3.0.';
    };

    this.is36 = function() {
        return Application.version.substr(0, 4) >=  '3.6.';
    };

    this.$ = function(id, doc) {
        if (doc === undefined)
            doc = document;
        return doc.getElementById(id);
    };

    // Loads a string bundle and returns a key -> value map.
    this.getStringBundle = function(name) {
        var bundle = Components.classes["@mozilla.org/intl/stringbundle;1"]
                         .getService(Components.interfaces.nsIStringBundleService)
                         .createBundle('chrome://nosquint/locale/' + name + '.properties');
        var strings = {}
        var enum = bundle.getSimpleEnumeration();
        while (enum.hasMoreElements()) {
            var str = enum.getNext().QueryInterface(Components.interfaces.nsIPropertyElement);
            strings[str.key] = str.value;
        }
        return strings;
    }

    this.strings = this.getStringBundle('overlay');

    /* Returns a list of lines from a URL (such as chrome://).
     */
    this.readLines = function(aURL) {
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
    };


    /* Given a FQDN, returns only the base domain, and honors two-level TLDs.
     * So for example, www.foo.bar.com returns bar.com, or www.foo.bar.co.uk
     * returns bar.co.uk.
     */
    this.getBaseDomainFromHost = function(host) {
        if (this.storage.TLDs === undefined) {
            // First window opened, so parse from stored list, which is
            // borrowed from http://www.surbl.org/two-level-tlds
            this.storage.TLDs = {};
            for each (let line in this.readLines('chrome://nosquint/content/two-level-tlds'))
                this.storage.TLDs[line] = true;
        }
        if (host.match(/^[\d.]+$/) != null)
            // IP address.
            return host;

        var parts = host.split('.');
        var level2 = parts.slice(-2).join('.');
        var level3 = parts.slice(-3).join('.');
        if (this.storage.TLDs[level3])
            return parts.slice(-4).join('.');
        else if (this.storage.TLDs[level2])
            return level3;
        return level2;
    };


    // XXX: don't forget to disable this for releases.
    this.debug = function(msg) {
        dump("[nosquint] " + msg + "\n");
    };

    /* This function is called a lot, so we take some care to optimize for the
     * common cases.
     */
    this.isChrome = function(browser) {
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
        if (document.URL == undefined || document.URL.substr(0, 6) == 'about:')
            return true;
        if (document.contentType == 'text/html' || document.contentType == 'application/xhtml+xml')
            return false;

        // Less common cases that we'll cover with the more expensive regexp.
        return document.contentType.search(/^text\/(plain|css|xml|javascript)/) != 0;
    };

    this.isImage = function(browser) {
        return browser.docShell.document.contentType.search(/^image\//) == 0;
    };

    this.getImage = function(doc) {
        // Not yet.
        /*
        var svg = doc.getElementsByTagName('svg');
        if (svg.length > 0)
            return svg[0];
        */
        return doc.body ? doc.body.firstChild : null;
    };

    this.foreachNSQ = (function() {
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                           .getService(Components.interfaces.nsIWindowMediator);
        return function(callback) {
            var enumerator = wm.getEnumerator("navigator:browser");
            var win;
            while (win = enumerator.getNext())
                if (win.NoSquint && callback(win.NoSquint) === false)
                    break;
            return win;
        };
    })();


    this.popup = function(type, title, text, value) {
        var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                      .getService(Components.interfaces.nsIPromptService);
        if (type == 'confirm') 
            return prompts.confirmEx(window, title, text,
                                     prompts.STD_YES_NO_BUTTONS, null, null, null, 
                                     null, {value: null});
        else if (type == 'alert')
            return prompts.alert(window, title, text);
        else if (type == 'prompt') {
            var data = {value: value};
            prompts.prompt(window, title, text, data, null, {});
            return data.value;
        }
        return null;
    };


    // Pythonic general purpose iterators.
    this.iter = function() {
        for (let i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            // duck typing
            if (arg.length !== undefined) { 
                for (let idx = 0; idx < arg.length; idx++)
                    yield arg[idx];
            } else {
                for (let key in arg)
                    yield key
            }
        }
    };

    this.items = function() {
        for (let i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            for each (let [key, value] in Iterator(arg))
                yield [key, value];
        }
    };

    this.values = function() {
        for (let i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            for each (let [key, value] in Iterator(arg))
                yield value;
        }
    };

    this.enumerate = function(o) {
        var n = 0;
        for (let i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            for (let value in this.iter(arg))
                yield [n++, value];
        }
    };

}).apply(NoSquint);
