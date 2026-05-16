/**
 * SpatialReasoner
 * 
 * Maps natural spatial language to semantic screen regions and specific UI elements.
 */
export class SpatialReasoner {
  constructor() {
    // Semantic regions mapped to relative coordinates (0.0 to 1.0)
    this.regions = {
      topLeft: { x: [0, 0.33], y: [0, 0.33] },
      topCenter: { x: [0.33, 0.66], y: [0, 0.33] },
      topRight: { x: [0.66, 1], y: [0, 0.33] },
      centerLeft: { x: [0, 0.33], y: [0.33, 0.66] },
      center: { x: [0.33, 0.66], y: [0.33, 0.66] },
      centerRight: { x: [0.66, 1], y: [0.33, 0.66] },
      bottomLeft: { x: [0, 0.33], y: [0.66, 1] },
      bottomCenter: { x: [0.33, 0.66], y: [0.66, 1] },
      bottomRight: { x: [0.66, 1], y: [0.66, 1] }
    };
  }

  /**
   * Filters a list of UI elements based on a spatial phrase.
   * @param {Array} elements - List of detected UI elements with bounding boxes
   * @param {Object} screenSize - { width, height }
   * @param {string} spatialPhrase - e.g., "bottom left", "near chrome"
   * @returns {Array} Filtered and scored elements
   */
  resolveSpatialReference(elements, screenSize, spatialPhrase) {
    if (!spatialPhrase || !elements || elements.length === 0) return elements;
    
    const phrase = spatialPhrase.toLowerCase();
    
    // 1. Handle absolute regions (e.g. "top left")
    const matchedRegion = this._mapPhraseToRegion(phrase);
    if (matchedRegion) {
      return this._filterByRegion(elements, screenSize, matchedRegion);
    }
    
    // 2. Handle relative proximity (e.g. "near [anchor]")
    if (phrase.includes("near ") || phrase.includes("beside ") || phrase.includes("under ")) {
      const anchorMatch = phrase.replace(/near |beside |under |above |slightly /g, '').trim();
      const anchorElement = elements.find(e => e.label && e.label.toLowerCase().includes(anchorMatch));
      
      if (anchorElement) {
        return this._filterByProximity(elements, anchorElement, phrase);
      }
    }

    return elements; // Fallback if no spatial reasoning could be applied
  }

  _mapPhraseToRegion(phrase) {
    if (phrase.includes('top') && phrase.includes('left')) return this.regions.topLeft;
    if (phrase.includes('top') && phrase.includes('right')) return this.regions.topRight;
    if (phrase.includes('bottom') && phrase.includes('left')) return this.regions.bottomLeft;
    if (phrase.includes('bottom') && phrase.includes('right')) return this.regions.bottomRight;
    if (phrase.includes('center') || phrase.includes('middle')) return this.regions.center;
    if (phrase.includes('top')) return this.regions.topCenter;
    if (phrase.includes('bottom')) return this.regions.bottomCenter;
    return null;
  }

  _filterByRegion(elements, screenSize, region) {
    return elements.filter(el => {
      // Calculate normalized center of the element
      const nx = (el.x + (el.width / 2)) / screenSize.width;
      const ny = (el.y + (el.height / 2)) / screenSize.height;
      
      return nx >= region.x[0] && nx <= region.x[1] &&
             ny >= region.y[0] && ny <= region.y[1];
    }).map(el => ({ ...el, spatialConfidence: 0.9 }));
  }

  _filterByProximity(elements, anchor, relationshipPhrase) {
    return elements.filter(el => el !== anchor).map(el => {
      // Calculate euclidean distance between centers
      const dx = (el.x + el.width/2) - (anchor.x + anchor.width/2);
      const dy = (el.y + el.height/2) - (anchor.y + anchor.height/2);
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      let score = 1.0 / (1.0 + (distance / 100)); // Closer is better
      
      // Directional weighting
      if (relationshipPhrase.includes('under') || relationshipPhrase.includes('below')) {
        if (dy < 0) score *= 0.1; // Penalize if it's actually above
      }
      if (relationshipPhrase.includes('above')) {
        if (dy > 0) score *= 0.1; // Penalize if it's actually below
      }
      
      return { ...el, spatialConfidence: score };
    }).sort((a, b) => b.spatialConfidence - a.spatialConfidence);
  }
}
