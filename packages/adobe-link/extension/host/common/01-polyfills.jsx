// Zenvi Link: the few ES5 built-ins ExtendScript (ECMAScript 3) lacks and the
// host scripts use. Each is defined only when missing.
//
// Only Array.prototype.indexOf and String.prototype.trim touch a prototype.
// Every CEP extension in the app shares one ExtendScript engine, and extra
// enumerable members on Array.prototype show up in other scripts' for-in
// loops, so iteration helpers live on ZenviLink (each/map/filter) instead of
// Array.prototype.forEach/map/filter.

if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (search, fromIndex) {
        var length = this.length >>> 0;
        var i = fromIndex ? Number(fromIndex) : 0;
        if (i !== i) {
            i = 0;
        }
        if (i < 0) {
            i = Math.max(length + i, 0);
        }
        for (; i < length; i += 1) {
            if (i in this && this[i] === search) {
                return i;
            }
        }
        return -1;
    };
}

if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return String(this).replace(/^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$/g, "");
    };
}

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
