import { Injectable } from '@angular/core';

export interface HydrationDiff {
  type: 'attribute' | 'text' | 'structure';
  path: string;
  serverValue: string;
  clientValue: string;
  explanation: string;
}

@Injectable({
  providedIn: 'root'
})
export class HydrationDiffService {
  /**
   * Compares server and client HTML strings and returns identified mismatches.
   */
  generateDiff(serverHtml: string, clientHtml: string): HydrationDiff[] {
    const diffs: HydrationDiff[] = [];
    
    try {
      const parser = new DOMParser();
      const serverDoc = parser.parseFromString(serverHtml, 'text/html');
      const clientDoc = parser.parseFromString(clientHtml, 'text/html');
      
      this.compareNodes(serverDoc.body, clientDoc.body, 'body', diffs);
    } catch (e) {
      console.error('[HydrationDiff] Comparison failed:', e);
    }
    
    return diffs;
  }

  private compareNodes(server: Node, client: Node, path: string, diffs: HydrationDiff[]): void {
    // 1. Check Node Type
    if (server.nodeType !== client.nodeType) {
      diffs.push({
        type: 'structure',
        path,
        serverValue: this.getNodeName(server),
        clientValue: this.getNodeName(client),
        explanation: 'Structural mismatch: Node types do not match.'
      });
      return;
    }

    // 2. Check Text Content
    if (server.nodeType === Node.TEXT_NODE) {
      const serverText = server.textContent?.trim();
      const clientText = client.textContent?.trim();
      if (serverText !== clientText) {
        diffs.push({
          type: 'text',
          path,
          serverValue: serverText || '(empty)',
          clientValue: clientText || '(empty)',
          explanation: 'Text mismatch: Content or whitespace differs.'
        });
      }
      return;
    }

    // 3. Check Element Attributes
    if (server instanceof Element && client instanceof Element) {
      const serverAttrs = server.getAttributeNames().sort();
      const clientAttrs = client.getAttributeNames().sort();

      for (const attr of serverAttrs) {
        const sVal = server.getAttribute(attr);
        const cVal = client.getAttribute(attr);
        if (sVal !== cVal) {
          diffs.push({
            type: 'attribute',
            path: `${path}[${attr}]`,
            serverValue: sVal || '(null)',
            clientValue: cVal || '(null)',
            explanation: `Attribute mismatch: Value for "${attr}" changed.`
          });
        }
      }
      
      // Check for children
      const serverChildren = Array.from(server.childNodes);
      const clientChildren = Array.from(client.childNodes);
      const max = Math.max(serverChildren.length, clientChildren.length);
      
      for (let i = 0; i < max; i++) {
        if (!serverChildren[i]) {
          diffs.push({ type: 'structure', path: `${path}>child[${i}]`, serverValue: '(none)', clientValue: this.getNodeName(clientChildren[i]), explanation: 'Unexpected client node.' });
        } else if (!clientChildren[i]) {
          diffs.push({ type: 'structure', path: `${path}>child[${i}]`, serverValue: this.getNodeName(serverChildren[i]), clientValue: '(none)', explanation: 'Missing client node.' });
        } else {
          this.compareNodes(serverChildren[i], clientChildren[i], `${path}>${this.getNodeName(serverChildren[i])}[${i}]`, diffs);
        }
      }
    }
  }

  private getNodeName(node: Node): string {
    return node instanceof Element ? node.tagName.toLowerCase() : 'text';
  }
}
