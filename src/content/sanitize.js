// chrome://browser/content/sanitize.xul 
// chrome://browser/content/preferences/sanitize.xul 

NoSquint.sanitizer = NoSquint.ns(function() { with (NoSquint) {
    this.init = function() {
        // Adds nosquint option to sanitizer UI
        this.attachOption(NSQ.strings.sanitizeLabel)
        if (typeof Sanitizer != 'undefined')
            // Installs NoSquint hooks into the sanitizer
            this.hookSanitizer();
    };

    this.attachOption = function(label) {
        var inSanitizeDialog = typeof(gSanitizePromptDialog) == 'object';
        // TODO: put this into a convenience function in lib.js
        var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefBranch);

        // pref domain is privacy.cpd. for Firefox 3.1+, and privacy.item. for 3.0
        // and earlier.
        var domain = 'privacy.cpd.';
        if ($('privacy.item.cache'))
            domain = 'privacy.item.';
        var prefs = document.getElementsByTagName('preferences')[0];
        var pref = document.createElement('preference');
        pref.setAttribute('id', domain + 'extensions-nosquint');
        pref.setAttribute('name', domain + 'extensions-nosquint');
        pref.setAttribute('type', 'bool');
        var value = prefService.getBoolPref(domain + 'extensions-nosquint');
        pref.setAttribute('value', value);
        prefService.setBoolPref(domain + 'extensions-nosquint', value);
        prefs.appendChild(pref);

        if ($('itemList')) {
            // In Clear Recent History dialog in Firefox 3.0
            var check = $('itemList').appendItem(label);
            check.setAttribute('type', 'checkbox');
        } else {
            // Firefox 3.0, or Firefox 3.5 in Settings, where the user sets which to enable/disable.
            var check = document.createElement('checkbox');
            check.setAttribute('label', label);
            var rows = document.getElementsByTagName('rows');
            if (rows.length) {
                // Firefox 3.5
                // Add new row to to rows.  TODO: append to last row if only has one column
                var row = document.createElement('row');
                row.appendChild(check);
                rows[0].appendChild(row);
            } else
                // Firefox 3.0
                document.getElementsByTagName('checkbox')[0].parentNode.appendChild(check);
        }    
        check.setAttribute('preference', domain + 'extensions-nosquint');
        check.setAttribute('checked', value);

        if (inSanitizeDialog) {
            pref.setAttribute('readonly', 'true');
            check.setAttribute('onsyncfrompreference', 'return gSanitizePromptDialog.onReadGeneric();');
            if (prefService.getCharPref('extensions.nosquint.sites') == '') {
                /* FIXME: a minor race condition: if user made first zoom change
                 * and immediately opened sanitizer (before 5s timeout to store sites)
                 * we will disable the checkbox when we shouldn't.
                 */
                check.setAttribute('disabled', true);
                check.setAttribute('checked', false);
            }
        }
    };

    this.hookSanitizer = function() {
        Sanitizer.prototype.items['extensions-nosquint'] = {
            clear: function() {
                NSQ.prefs.sanitize(this.range);
            },
            get canClear() {
                return true;
            }
        };
    };

}});
