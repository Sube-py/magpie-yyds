// A DOM small enough to run page/app.js in Node: elements, class selectors,
// events, and a `<template>`'s content. The page touches nothing else.

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parent = null
    this.attrs = {}
    this.dataset = {}
    this.listeners = {}
    this.className = ""
    this.value = ""
    this.type = ""
    this.placeholder = ""
    this.disabled = false
    this.hidden = false
    this._text = ""
  }

  get classes() {
    return this.className.split(/\s+/).filter(Boolean)
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("")
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }

  getAttribute(name) {
    return this.attrs[name] ?? null
  }

  append(...kids) {
    for (const kid of kids) {
      kid.parent = this
      this.children.push(kid)
    }
  }

  replaceChildren(...kids) {
    this.children = []
    this._text = ""
    this.append(...kids)
  }

  cloneNode() {
    const copy = new El(this.tagName)
    copy.className = this.className
    copy.attrs = { ...this.attrs }
    copy.dataset = { ...this.dataset }
    copy.type = this.type
    copy.placeholder = this.placeholder
    copy.value = this.value
    copy.append(...this.children.map((kid) => kid.cloneNode()))
    return copy
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const wanted = selector.startsWith(".") ? selector.slice(1) : selector.toLowerCase()
    const byClass = selector.startsWith(".")
    const out = []
    const walk = (node) => {
      for (const kid of node.children) {
        if (byClass ? kid.classes.includes(wanted) : kid.tagName.toLowerCase() === wanted) out.push(kid)
        walk(kid)
      }
    }
    walk(this)
    return out
  }

  addEventListener(type, fn) {
    ;(this.listeners[type] ??= []).push(fn)
  }

  fire(type) {
    for (const fn of this.listeners[type] ?? []) fn({ type, target: this, preventDefault() {} })
  }

  focus() {}
}

/** A page: a document with the elements the page asks for by id. */
export function makePage({ row, ids = [] } = {}) {
  const byId = new Map()
  for (const id of ids) byId.set(id, new El(id === "row" ? "template" : "div"))
  if (row) byId.get("row").content = { firstElementChild: row }
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new El(tag),
  }
  return { document, byId, el: (id) => byId.get(id) }
}

/** The row as page/index.html templates it, class by class. */
export function rowTemplate() {
  const row = new El("li")
  row.className = "row"
  const num = new El("span")
  num.className = "num"
  const label = new El("label")
  label.className = "field label"
  const labelInput = new El("input")
  labelInput.className = "label-input"
  const keyField = new El("label")
  keyField.className = "field key"
  const secret = new El("span")
  secret.className = "secret"
  const keyInput = new El("input")
  keyInput.className = "key-input"
  const show = new El("button")
  show.className = "show"
  secret.append(keyInput, show)
  keyField.append(secret)
  label.append(labelInput)
  const tools = new El("span")
  tools.className = "tools"
  for (const name of ["up", "down", "rm"]) {
    const button = new El("button")
    button.className = name
    tools.append(button)
  }
  row.append(num, label, keyField, tools)
  return row
}

export { El }
