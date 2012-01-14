// chrome://browser/content/sanitize.xul 
function hookSanitizer() {
    window.removeEventListener('load', hookSanitizer, true);
    Sanitizer.prototype.items['extensions-nosquint'] = {
        clear: function() {
            /* Find all NoSquint instances and force a site list save if dirty.
             */
            var last = null;
            foreach_window(function(win) {
                if (win._noSquint) {
                    if (win._noSquint.sitesDirty)
                        win._noSquint._realSaveSiteList();
                    last = win._noSquint;
                }
            });
            if (last)
                last.sanitize(this.range);
        },
        get canClear() {
            return true;
        }
    };
}

function attach(label) {
    window.addEventListener('load', hookSanitizer, true);
    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                        .getService(Components.interfaces.nsIPrefBranch);

    // pref domain is privacy.cpd. for Firefox 3.1+, and privacy.item. for 3.0
    // and earlier.
    var domain = 'privacy.cpd.';
    if (document.getElementById('privacy.item.cache'))
        domain = 'privacy.item.';
    var prefs = document.getElementsByTagName('preferences')[0];
    var pref = document.createElement('preference');
    pref.setAttribute('id', domain + 'extensions-nosquint');
    pref.setAttribute('name', domain + 'extensions-nosquint');
    pref.setAttribute('type', 'bool');
    var value = prefService.getBoolPref('privacy.item.extensions-nosquint');
    pref.setAttribute('value', value);
    prefService.setBoolPref('privacy.cpd.extensions-nosquint', value);
    prefs.appendChild(pref);

    if (document.getElementById('itemList')) {
        // Firefox 3.5
        var check = document.getElementById('itemList').appendItem(label);
        check.setAttribute('type', 'checkbox');
    } else {
        // Firefox 3.0
        var check = document.createElement('checkbox');
        check.setAttribute('label', label);
        document.getElementsByTagName('checkbox')[0].parentNode.appendChild(check);
    }    
    check.setAttribute('preference', domain + 'extensions-nosquint');
    if (prefService.getCharPref('extensions.nosquint.sites') == '')
        // FIXME: a minor race condition: if user made first zoom change
        // and immediately opened sanitizer (before 5s timeout to store sites)
        // we will disable the checkbox when we shouldn't.
        check.setAttribute('disabled', true);

     if (typeof(gSanitizePromptDialog) == 'object')
     {  
        pref.setAttribute('readonly', 'true');
        check.setAttribute('onsyncfrompreference', 'return gSanitizePromptDialog.onReadGeneric();');
     }
}
