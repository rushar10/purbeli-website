/* dc-lite: a tiny renderer for the Purbeli page templates.
   Supports {{holes}}, <sc-if>, <sc-for>, event bindings (onClick etc.), ref callbacks,
   and a Component class with state, setState, forceUpdate and lifecycle hooks. */
(function () {
  'use strict';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p || {});
    this.__schedule && this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () { this.__schedule && this.__schedule(); };

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    for (var i = scope.length - 1; i >= 0; i--) {
      var s = scope[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var j = 1; j < parts.length; j++) { if (v == null) return undefined; v = v[parts[j]]; }
        return v;
      }
    }
    return undefined;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  var BOOL_PROPS = { checked: 1, disabled: 1, selected: 1, readonly: 1, required: 1, hidden: 1, multiple: 1, novalidate: 1 };

  function build(tpl, scope, out) {
    for (var n = tpl.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var t = n.nodeValue;
        out.appendChild(document.createTextNode(t.indexOf('{{') >= 0 ? interp(t, scope) : t));
        continue;
      }
      if (n.nodeType !== 1) continue;
      var tag = n.localName;
      if (tag === 'sc-if') {
        var cond = lookup((n.getAttribute('value') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
        if (cond) build(n, scope, out);
        continue;
      }
      if (tag === 'sc-for') {
        var list = lookup((n.getAttribute('list') || '').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope) || [];
        var as = n.getAttribute('as') || 'item';
        for (var i = 0; i < list.length; i++) {
          var frame = { $index: i }; frame[as] = list[i];
          build(n, scope.concat([frame]), out);
        }
        continue;
      }
      var el = n.namespaceURI === 'http://www.w3.org/2000/svg'
        ? document.createElementNS(n.namespaceURI, tag)
        : document.createElement(tag);
      for (var a = 0; a < n.attributes.length; a++) {
        var at = n.attributes[a], name = at.name, val = at.value;
        if (name.indexOf('hint-') === 0) continue;
        var m = WHOLE.exec(val), raw = m ? lookup(m[1], scope) : undefined;
        if (name === 'ref') { if (typeof raw === 'function') el.__ref = raw; continue; }
        if (name.length > 2 && name.indexOf('on') === 0) {
          if (typeof raw === 'function') { (el.__h || (el.__h = {}))[name.slice(2).toLowerCase()] = raw; }
          continue;
        }
        if (m) {
          if (raw === false || raw == null) { continue; }
          if (raw === true) { el.setAttribute(name, BOOL_PROPS[name] ? '' : 'true'); continue; }
          el.setAttribute(name, String(raw));
          continue;
        }
        el.setAttribute(name, val.indexOf('{{') >= 0 ? interp(val, scope) : val);
      }
      if (tag === 'textarea' && el.hasAttribute('value')) el.textContent = el.getAttribute('value');
      build(n.content || n, scope, el);
      out.appendChild(el);
    }
  }

  function wire(root) {
    var all = root.querySelectorAll('*');
    var list = [root].concat(Array.prototype.slice.call(all));
    list.forEach(function (el) {
      if (el.__h) {
        el.__inst = el.__inst || {};
        Object.keys(el.__h).forEach(function (type) {
          if (el.__inst[type]) return;
          el.__inst[type] = true;
          el.addEventListener(type, function (e) { var f = el.__h && el.__h[type]; if (f) f(e); });
        });
      }
    });
    list.forEach(function (el) { if (el.__ref) el.__ref(el); });
    list.forEach(function (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.hasAttribute('checked');
        else if (el.hasAttribute('value') && document.activeElement !== el) el.value = el.getAttribute('value');
      }
    });
  }

  function mount(rootEl) {
    var tplEl = document.getElementById('dc-template');
    var scriptEl = document.getElementById('dc-script');
    var defs = {};
    try { defs = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); } catch (e) { defs = {}; }
    var props = {};
    var over = window.DC_PROPS || {};
    Object.keys(defs).forEach(function (k) { if (k.charAt(0) !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k].default; });
    Object.keys(over).forEach(function (k) { props[k] = over[k]; });
    var Component = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic);
    var inst = new Component(props);
    inst.props = props;
    inst.state = inst.state || {};
    var queued = false, mounted = false;

    function render() {
      queued = false;
      var vals = inst.renderVals() || {};
      var frag = document.createElement('div');
      build(tplEl.content, [vals], frag);
      if (!mounted) {
        while (frag.firstChild) rootEl.appendChild(frag.firstChild);
      } else {
        window.morphdom(rootEl, frag, {
          childrenOnly: true,
          onBeforeElUpdated: function (from, to) {
            if (from.tagName === 'CANVAS' || from.hasAttribute('data-dc-keep')) return false;
            from.__h = to.__h; from.__ref = to.__ref;
            if ((from.tagName === 'INPUT' || from.tagName === 'TEXTAREA') && from === document.activeElement && from.type !== 'checkbox' && from.type !== 'radio') {
              to.value = from.value; if (to.hasAttribute('value')) to.setAttribute('value', from.value);
            }
            return true;
          }
        });
      }
      wire(rootEl);
      if (!mounted) { mounted = true; if (inst.componentDidMount) inst.componentDidMount(); }
    }
    inst.__schedule = function () { if (!queued) { queued = true; requestAnimationFrame(render); } };
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
    render();
  }

  window.DCLogic = DCLogic;
  document.addEventListener('DOMContentLoaded', function () { mount(document.getElementById('app')); });
})();
