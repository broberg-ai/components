import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { isEditableElement } from '../src/flow';
import { flowStepSchema } from '../src/schema';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
function el(html: string): Element {
  const host = doc.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild as Element;
}

describe('isEditableElement — contenteditable', () => {
  it('a contenteditable element is editable (bare, =true, plaintext-only)', () => {
    expect(isEditableElement(el('<div contenteditable>x</div>'))).toBe(true);
    expect(isEditableElement(el('<div contenteditable="true">x</div>'))).toBe(true);
    expect(isEditableElement(el('<div contenteditable="plaintext-only">x</div>'))).toBe(true);
  });

  it('a plain element is not editable', () => {
    expect(isEditableElement(el('<div>x</div>'))).toBe(false);
    expect(isEditableElement(el('<p>x</p>'))).toBe(false);
    expect(isEditableElement(el('<span>x</span>'))).toBe(false);
  });

  it('a child inherits a contenteditable ancestor', () => {
    const root = el('<div contenteditable><section><span>hi</span></section></div>');
    expect(isEditableElement(root.querySelector('span')!)).toBe(true);
  });

  it('contenteditable="false" wins, including for a descendant', () => {
    expect(isEditableElement(el('<div contenteditable="false">x</div>'))).toBe(false);
    const root = el('<div contenteditable="false"><span>x</span></div>');
    expect(isEditableElement(root.querySelector('span')!)).toBe(false);
  });

  it('nearest ancestor wins: false nested inside true is not editable', () => {
    const root = el('<div contenteditable="true"><div contenteditable="false"><b>x</b></div></div>');
    expect(isEditableElement(root.querySelector('b')!)).toBe(false);
  });
});

describe('isEditableElement — native form controls', () => {
  it('an enabled input/textarea/select is editable', () => {
    expect(isEditableElement(el('<input>'))).toBe(true);
    expect(isEditableElement(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableElement(el('<select><option>a</option></select>'))).toBe(true);
  });

  it('a disabled or readonly control is not editable', () => {
    expect(isEditableElement(el('<input disabled>'))).toBe(false);
    expect(isEditableElement(el('<input readonly>'))).toBe(false);
    expect(isEditableElement(el('<textarea readonly></textarea>'))).toBe(false);
    expect(isEditableElement(el('<select disabled></select>'))).toBe(false);
  });
});

describe('flowStepSchema — expectEditable', () => {
  it('accepts a well-formed step', () => {
    expect(flowStepSchema.safeParse({ action: 'expectEditable', target: 'bio-field' }).success).toBe(true);
    expect(flowStepSchema.safeParse({ action: 'expectEditable', target: { testid: 'bio' } }).success).toBe(true);
  });

  it('rejects a step with no target', () => {
    expect(flowStepSchema.safeParse({ action: 'expectEditable' }).success).toBe(false);
  });
});
