// Zenvi Link: ES5 statics ExtendScript (ECMAScript 3) lacks and the host
// scripts use. Each is defined only when missing.
//
// Nothing here touches a prototype. Every CEP extension in the app shares one
// ExtendScript engine, ES3 cannot make a property non-enumerable, and a new
// member on Array.prototype or String.prototype would show up in every other
// script's for-in loops (`for (i in comp.selectedLayers)`). Use
// ZenviLink.indexOf / trim / each / map / filter instead of
// [].indexOf, "".trim(), forEach, map and filter.

if (!Array.isArray) {
    Array.isArray = function (value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    };
}

if (!Object.keys) {
    Object.keys = function (object) {
        var keys = [];
        var key;
        if (object === null || (typeof object !== "object" && typeof object !== "function")) {
            throw new TypeError("Object.keys called on a non-object");
        }
        for (key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key)) {
                keys.push(key);
            }
        }
        return keys;
    };
}

if (!Date.now) {
    Date.now = function () {
        return new Date().getTime();
    };
}
