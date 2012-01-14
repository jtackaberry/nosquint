var NoSquintPrefs = {
    prefs: null,
    site: null,
    level: null,
    NoSquint: null,

    init: function(doc, dialog) {
        NoSquintPrefs.doc = doc;
        NoSquintPrefs.dialog = dialog;
        var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);
        NoSquintPrefs.privacyBranch = prefService.getBranch('privacy.item.');

        if (window.arguments) {
            NoSquintPrefs.NoSquint = window.arguments[0];
            NoSquintPrefs.url = window.arguments[1];
            NoSquintPrefs.NoSquint.globalDialog = this;
            NoSquintPrefs.prefs = NoSquintPrefs.NoSquint.prefs;
        } else {
            NoSquintPrefs.prefs = prefService.getBranch("extensions.nosquint.")
        }

        // General tab
        var forget_cb = doc.getElementById("siteForget");
        var months = NoSquintPrefs.prefs.getIntPref("forgetMonths");
        forget_cb.checked = (months != 0);
        if (months)
            doc.getElementById("siteForget-menu").value = months;
        forget_cb.addEventListener("CheckboxStateChange", NoSquintPrefs.forgetMonthsChecked, false);
        NoSquintPrefs.forgetMonthsChecked();
        doc.getElementById("siteSanitize").checked = NoSquintPrefs.privacyBranch.getBoolPref("extensions-nosquint");
        doc.getElementById("rememberSites").selectedIndex = NoSquintPrefs.prefs.getBoolPref("rememberSites") ? 0 : 1;

        // Zooming tab
        doc.getElementById("fullZoomLevel").value = NoSquintPrefs.prefs.getIntPref("fullZoomLevel");
        doc.getElementById("textZoomLevel").value = NoSquintPrefs.prefs.getIntPref("textZoomLevel");
        doc.getElementById("zoomIncrement").value = NoSquintPrefs.prefs.getIntPref("zoomIncrement");
        doc.getElementById("zoomImages").checked = NoSquintPrefs.prefs.getBoolPref("zoomImages");
        doc.getElementById("showStatus").checked = !NoSquintPrefs.prefs.getBoolPref("hideStatus");
        doc.getElementById("wheelZoomEnabled").checked = NoSquintPrefs.prefs.getBoolPref("wheelZoomEnabled");
        doc.getElementById('primaryZoomMethod-menu').value = NoSquintPrefs.prefs.getBoolPref("fullZoomPrimary") ? "full" : "text";
        NoSquintPrefs.sitesRadioSelect();

        // Color tab
        for each (var [id, defcolor] in [['colorText', '#000000'], ['colorBackground', '#ffffff'], 
                                         ['linksUnvisited', '#0000ee'], ['linksVisited', '#551a8b']]) {
            var color = NoSquintPrefs.prefs.getCharPref(id);
            var cb = doc.getElementById(id);
            var picker = cb.parentNode.childNodes[1];
            picker.color = color == '0' ? defcolor : color;
            cb.addEventListener("CheckboxStateChange", NoSquintPrefs.colorChecked, false);
            cb.checked = color == '0' ? false : true;
            NoSquintPrefs.colorChecked(null, cb);
        }
        doc.getElementById('colorBackgroundImages').checked = NoSquintPrefs.prefs.getBoolPref("colorBackgroundImages");
        doc.getElementById('linksUnderline').checked = NoSquintPrefs.prefs.getBoolPref("linksUnderline");

        // Exceptions tab.
        NoSquintPrefs.parseExceptions();
        NoSquintPrefs.excListSelect();
    },

    colorChecked: function(event, cb) {
        cb = cb || this;
        var picker = cb.parentNode.childNodes[1];
        picker.disabled = !cb.checked;
        picker.style.opacity = cb.checked ? 1.0 : 0.2;
    },


    parseExceptions: function() {
        var exstr = NoSquintPrefs.prefs.getCharPref("exceptions");
        // Trim whitespace and split on space.
        var exlist = exstr.replace(/(^\s+|\s+$)/g, "").split(" ");
        for (var i = 0; i < exlist.length; i++) {
            if (exlist[i])
                NoSquintPrefs.exceptionsListAdd(exlist[i].replace(/%20/g, ' '), false);
        }
        NoSquintPrefs.doc.getElementById("exceptionsList")._changed = false;
    },

    exceptionsListAdd: function(pattern, check_dupe) {
        // Strip URI scheme from pattern (if it exists)
        pattern = pattern.replace(/^\w+:\/\//, '');

        var listbox = NoSquintPrefs.doc.getElementById("exceptionsList");
        if (check_dupe) {
            for (var i = 0; i < listbox.childNodes.length; i++) {
                var node = listbox.childNodes[i];
                if (node.childNodes[0].getAttribute("label") == pattern) {
                    var bundle = NoSquintPrefs.doc.getElementById("nosquint-prefs-bundle");
                    alert(bundle.getString('patternExists'));
                    return;
                }
            }
        }

        var node = NoSquintPrefs.doc.createElement("listitem");
        var li1 = NoSquintPrefs.doc.createElement("listcell");
        li1.setAttribute("label", pattern);
        node.appendChild(li1);
        listbox.appendChild(node);
        node.addEventListener("dblclick", NoSquintPrefs.buttonEditException, false);
        listbox._changed = true;
    },

    textPatternKeyPress: function(event) {
        if (event.keyCode == 13) {
            NoSquintPrefs.buttonAddException();
            return false;
        }
    },

    textPatternChange: function() {
        var pattern = NoSquintPrefs.doc.getElementById("pattern").value;
        var exc_button = NoSquintPrefs.doc.getElementById("exceptionAdd-button");
        exc_button.disabled = (pattern == '');
    },

    excListKeyPress: function(event) {
        if (event.keyCode == 13) {
            NoSquintPrefs.buttonEditException();
            return false;
        }
    },

    excListSelect: function() {
        var btn = NoSquintPrefs.doc.getElementById("exceptionRemove-button");
        var listbox = NoSquintPrefs.doc.getElementById("exceptionsList");
        btn.disabled = (listbox.selectedItems.length == 0);

        var btn = NoSquintPrefs.doc.getElementById("exceptionEdit-button");
        btn.disabled = listbox.selectedItems.length != 1;
    },

    buttonCopyFromURL: function() {
        var pattern = NoSquintPrefs.doc.getElementById("pattern");
        pattern.value = NoSquintPrefs.url;
        NoSquintPrefs.textPatternChange();
    },

    buttonAddException: function() {
        var pattern = NoSquintPrefs.doc.getElementById("pattern");
        NoSquintPrefs.exceptionsListAdd(pattern.value, true);
        pattern.value = '';
        NoSquintPrefs.textPatternChange();
    },


    buttonEditException: function() {
        var listbox = NoSquintPrefs.doc.getElementById("exceptionsList");
        var item = listbox.selectedItem;
        var pattern = item.childNodes[0].getAttribute('label');
        var bundle = NoSquintPrefs.doc.getElementById("nosquint-prefs-bundle");
        var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                      .getService(Components.interfaces.nsIPromptService);
        var input = {value: pattern};
        prompts.prompt(window, bundle.getString('editTitle'), bundle.getString('editPrompt'),
                        input, null, {});
        if (input.value != null && input.value != pattern) {
            item.childNodes[0].setAttribute('label', input.value);
            listbox._changed = true;
        }
    },

    buttonRemoveException: function() {
        var listbox = NoSquintPrefs.doc.getElementById("exceptionsList");
        while (listbox.selectedItems.length)
            listbox.removeChild(listbox.selectedItems[0]);
        listbox._changed = true;
    },

    forgetMonthsChecked: function() {
        var checked = NoSquintPrefs.doc.getElementById('siteForget').checked;
        NoSquintPrefs.doc.getElementById('siteForget-menu').disabled = !checked;
    },

    sitesRadioSelect: function() {
        var doc = NoSquintPrefs.doc;
        if (!doc)
            return;
        if (!NoSquintPrefs.url)
            doc.getElementById("copyURL-button").style.display = "none";
        var disabled = doc.getElementById("rememberSites").selectedIndex == 1;
        NoSquintPrefs.enableTree(doc.getElementById("siteForget-box"), disabled);
    },

    enableTree: function(node, state) {
        for (var i = 0; i < node.childNodes.length; i++) {
            var child = node.childNodes[i];
            if (state && child.disabled == false || child.disabled == true)
                child.disabled = state;
            if (child.childNodes.length)
                NoSquintPrefs.enableTree(child, state);
        }
    },

    help: function() {
        window.openDialog("chrome://nosquint/content/help.xul", "NoSquint Help", "chrome");
    },

    close: function() {
        var doc = NoSquintPrefs.doc;

        if (doc.getElementById("pattern").value != '')
            /* User entered stuff in exception input but OK'd dialog without
             * adding the exception.  We assume here the user actually _wanted_
             * the exception to be added, so add it automatically.  This is
             * a bit of do-what-I-mean behaviour.
             */
            NoSquintPrefs.buttonAddException();
            
        var full_zoom_primary = doc.getElementById("primaryZoomMethod-menu").value == "full";
        var force_zoom = NoSquintPrefs.prefs.getBoolPref("fullZoomPrimary") != full_zoom_primary;
        NoSquintPrefs.prefs.setBoolPref("fullZoomPrimary", full_zoom_primary);

        NoSquintPrefs.prefs.setBoolPref("zoomImages", doc.getElementById("zoomImages").checked);
        NoSquintPrefs.prefs.setBoolPref("hideStatus", !doc.getElementById("showStatus").checked);
        NoSquintPrefs.prefs.setBoolPref("wheelZoomEnabled", doc.getElementById("wheelZoomEnabled").checked);
        NoSquintPrefs.prefs.setIntPref("fullZoomLevel", doc.getElementById("fullZoomLevel").value);
        NoSquintPrefs.prefs.setIntPref("textZoomLevel", doc.getElementById("textZoomLevel").value);
        NoSquintPrefs.prefs.setIntPref("zoomIncrement", doc.getElementById("zoomIncrement").value);
        var val = doc.getElementById("rememberSites").selectedIndex == 1 ? false : true;
        NoSquintPrefs.prefs.setBoolPref("rememberSites", val);
        NoSquintPrefs.privacyBranch.setBoolPref("extensions-nosquint", 
                                                doc.getElementById("siteSanitize").checked)


        var listbox = doc.getElementById("exceptionsList");
        if (listbox._changed) {
            var exceptions = [];
            for (var i = 0; i < listbox.getRowCount(); i++) {
                var item = listbox.getItemAtIndex(i);
                var pattern = item.childNodes[0].getAttribute('label');
                exceptions.push(pattern.replace(/ /g, '%20'));
            }
            NoSquintPrefs.prefs.setCharPref("exceptions", exceptions.join(' '));
        }
        if (!doc.getElementById("siteForget").checked)
            NoSquintPrefs.prefs.setIntPref("forgetMonths", 0);
        else
            NoSquintPrefs.prefs.setIntPref("forgetMonths", doc.getElementById("siteForget-menu").value);

        // Colors
        for each (var id in ['colorText', 'colorBackground', 'linksUnvisited', 'linksVisited']) {
            var cb = doc.getElementById(id);
            var picker = cb.parentNode.childNodes[1];
            NoSquintPrefs.prefs.setCharPref(id, cb.checked ? picker.color : '0');
        }
        NoSquintPrefs.prefs.setBoolPref("colorBackgroundImages", 
                                        doc.getElementById("colorBackgroundImages").checked);
        NoSquintPrefs.prefs.setBoolPref("linksUnderline", 
                                        doc.getElementById("linksUnderline").checked);

        var NoSquint = NoSquintPrefs.NoSquint;
        if (!NoSquint)
            return;

        NoSquint.globalDialog = null;
        if (force_zoom)
            NoSquint.queueZoomAll();
        NoSquint.queueStyleAll();
        NoSquint.updateStatus();

        if (NoSquint.siteDialog)
            NoSquint.siteDialog.setValues(NoSquint.siteDialog.browser, NoSquint.siteDialog.browser._noSquintSite);

    },

    cancel: function() {
        if (NoSquintPrefs.NoSquint)
            NoSquintPrefs.NoSquint.globalDialog = null;
    }

};
