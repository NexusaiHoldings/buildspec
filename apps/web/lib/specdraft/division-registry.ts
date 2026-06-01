/**
 * CSI MasterFormat Division Registry — authoritative taxonomy for Divisions 03-48.
 *
 * Provides the canonical division codes, titles, and three-part spec structure
 * used throughout the spec drafting engine. Keeping this as a pure static module
 * means hallucination risk on code references (key_technical_risk #1) is mitigated
 * at import time — every division reference is validated against this registry.
 */

export interface CsiSubSection {
  readonly code: string;
  readonly title: string;
}

export interface CsiDivision {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly primarySections: readonly CsiSubSection[];
}

export const CSI_DIVISIONS: readonly CsiDivision[] = [
  {
    id: "03",
    number: 3,
    title: "Concrete",
    description: "Cast-in-place concrete, precast concrete, grout, and cement-based materials.",
    primarySections: [
      { code: "03 10 00", title: "Concrete Forming and Accessories" },
      { code: "03 20 00", title: "Concrete Reinforcing" },
      { code: "03 30 00", title: "Cast-in-Place Concrete" },
      { code: "03 40 00", title: "Precast Concrete" },
      { code: "03 50 00", title: "Cast Decks and Underlayment" },
    ],
  },
  {
    id: "04",
    number: 4,
    title: "Masonry",
    description: "Unit masonry, stone, glass unit masonry, and masonry restoration.",
    primarySections: [
      { code: "04 20 00", title: "Unit Masonry" },
      { code: "04 40 00", title: "Stone Assemblies" },
      { code: "04 50 00", title: "Refractory Masonry" },
      { code: "04 70 00", title: "Manufactured Masonry" },
    ],
  },
  {
    id: "05",
    number: 5,
    title: "Metals",
    description: "Structural metal framing, metal joists, decking, cold-formed metal framing, and ornamental metal.",
    primarySections: [
      { code: "05 10 00", title: "Structural Metal Framing" },
      { code: "05 20 00", title: "Metal Joists" },
      { code: "05 30 00", title: "Metal Decking" },
      { code: "05 40 00", title: "Cold-Formed Metal Framing" },
      { code: "05 50 00", title: "Metal Fabrications" },
      { code: "05 70 00", title: "Decorative Metal" },
    ],
  },
  {
    id: "06",
    number: 6,
    title: "Wood, Plastics, and Composites",
    description: "Rough carpentry, finish carpentry, architectural woodwork, and composite materials.",
    primarySections: [
      { code: "06 10 00", title: "Rough Carpentry" },
      { code: "06 20 00", title: "Finish Carpentry" },
      { code: "06 40 00", title: "Architectural Woodwork" },
      { code: "06 50 00", title: "Structural Plastics" },
      { code: "06 60 00", title: "Plastic Fabrications" },
    ],
  },
  {
    id: "07",
    number: 7,
    title: "Thermal and Moisture Protection",
    description: "Dampproofing, waterproofing, roofing, siding, insulation, and joint protection.",
    primarySections: [
      { code: "07 10 00", title: "Dampproofing and Waterproofing" },
      { code: "07 20 00", title: "Thermal Protection" },
      { code: "07 30 00", title: "Steep Slope Roofing" },
      { code: "07 40 00", title: "Roofing and Siding Panels" },
      { code: "07 50 00", title: "Membrane Roofing" },
      { code: "07 60 00", title: "Flashing and Sheet Metal" },
      { code: "07 70 00", title: "Roof and Wall Specialties and Accessories" },
      { code: "07 90 00", title: "Joint Protection" },
    ],
  },
  {
    id: "08",
    number: 8,
    title: "Openings",
    description: "Doors, windows, hardware, glazing, and louvers.",
    primarySections: [
      { code: "08 10 00", title: "Doors and Frames" },
      { code: "08 30 00", title: "Specialty Doors and Frames" },
      { code: "08 40 00", title: "Entrances, Storefronts, and Curtain Walls" },
      { code: "08 50 00", title: "Windows" },
      { code: "08 60 00", title: "Roof Windows and Skylights" },
      { code: "08 70 00", title: "Hardware" },
      { code: "08 80 00", title: "Glazing" },
      { code: "08 90 00", title: "Louvers and Vents" },
    ],
  },
  {
    id: "09",
    number: 9,
    title: "Finishes",
    description: "Plaster, gypsum board, tiling, ceilings, flooring, wall finishes, and painting.",
    primarySections: [
      { code: "09 20 00", title: "Plaster and Gypsum Board" },
      { code: "09 30 00", title: "Tiling" },
      { code: "09 50 00", title: "Ceilings" },
      { code: "09 60 00", title: "Flooring" },
      { code: "09 70 00", title: "Wall Finishes" },
      { code: "09 90 00", title: "Paints and Coatings" },
    ],
  },
  {
    id: "10",
    number: 10,
    title: "Specialties",
    description: "Visual display units, compartments and cubicles, louvers and vents, and signage.",
    primarySections: [
      { code: "10 10 00", title: "Information Specialties" },
      { code: "10 20 00", title: "Interior Specialties" },
      { code: "10 40 00", title: "Safety Specialties" },
      { code: "10 50 00", title: "Storage Specialties" },
      { code: "10 70 00", title: "Exterior Specialties" },
    ],
  },
  {
    id: "11",
    number: 11,
    title: "Equipment",
    description: "Vehicle and pedestrian equipment, commercial and industrial equipment.",
    primarySections: [
      { code: "11 10 00", title: "Vehicle and Pedestrian Equipment" },
      { code: "11 20 00", title: "Commercial Equipment" },
      { code: "11 30 00", title: "Residential Equipment" },
      { code: "11 40 00", title: "Foodservice Equipment" },
      { code: "11 50 00", title: "Educational and Scientific Equipment" },
      { code: "11 60 00", title: "Entertainment Equipment" },
    ],
  },
  {
    id: "12",
    number: 12,
    title: "Furnishings",
    description: "Art, blinds, shades, furniture, and rugs.",
    primarySections: [
      { code: "12 10 00", title: "Art" },
      { code: "12 20 00", title: "Window Treatments" },
      { code: "12 30 00", title: "Casework" },
      { code: "12 40 00", title: "Furnishings and Accessories" },
      { code: "12 50 00", title: "Furniture" },
      { code: "12 60 00", title: "Multiple Seating" },
    ],
  },
  {
    id: "13",
    number: 13,
    title: "Special Construction",
    description: "Air-supported structures, building modules, and special-purpose structures.",
    primarySections: [
      { code: "13 10 00", title: "Special Facility Components" },
      { code: "13 20 00", title: "Special Purpose Rooms" },
      { code: "13 30 00", title: "Special Structures" },
      { code: "13 40 00", title: "Special Instrumentation" },
      { code: "13 50 00", title: "Special Controls and Instrumentation" },
    ],
  },
  {
    id: "14",
    number: 14,
    title: "Conveying Equipment",
    description: "Elevators, escalators, moving walks, and pneumatic tube systems.",
    primarySections: [
      { code: "14 10 00", title: "Dumbwaiters" },
      { code: "14 20 00", title: "Elevators" },
      { code: "14 30 00", title: "Escalators and Moving Walks" },
      { code: "14 40 00", title: "Lifts" },
      { code: "14 90 00", title: "Other Conveying Equipment" },
    ],
  },
  {
    id: "21",
    number: 21,
    title: "Fire Suppression",
    description: "Water-based fire suppression, fire extinguishing systems, and fire pumps.",
    primarySections: [
      { code: "21 10 00", title: "Water-Based Fire-Suppression Systems" },
      { code: "21 20 00", title: "Fire-Extinguishing Systems" },
      { code: "21 30 00", title: "Fire Pumps" },
    ],
  },
  {
    id: "22",
    number: 22,
    title: "Plumbing",
    description: "Plumbing insulation, plumbing fixtures, domestic water distribution, and sewerage.",
    primarySections: [
      { code: "22 05 00", title: "Common Work Results for Plumbing" },
      { code: "22 10 00", title: "Plumbing Piping and Pumps" },
      { code: "22 30 00", title: "Plumbing Equipment" },
      { code: "22 40 00", title: "Plumbing Fixtures" },
    ],
  },
  {
    id: "23",
    number: 23,
    title: "Heating, Ventilating, and Air Conditioning (HVAC)",
    description: "HVAC insulation, air distribution, HVAC piping, and central heating/cooling.",
    primarySections: [
      { code: "23 05 00", title: "Common Work Results for HVAC" },
      { code: "23 07 00", title: "HVAC Insulation" },
      { code: "23 20 00", title: "HVAC Piping and Pumps" },
      { code: "23 30 00", title: "HVAC Air Distribution" },
      { code: "23 60 00", title: "Central Heating Equipment" },
      { code: "23 70 00", title: "Central HVAC Equipment" },
      { code: "23 80 00", title: "Decentralized HVAC Equipment" },
    ],
  },
  {
    id: "25",
    number: 25,
    title: "Integrated Automation",
    description: "Building automation and control systems integration.",
    primarySections: [
      { code: "25 10 00", title: "Integrated Automation Network Equipment" },
      { code: "25 30 00", title: "Integrated Automation Instrumentation and Terminal Devices" },
      { code: "25 50 00", title: "Integrated Automation Facility Controls" },
    ],
  },
  {
    id: "26",
    number: 26,
    title: "Electrical",
    description: "Medium and low voltage distribution, lighting, and emergency systems.",
    primarySections: [
      { code: "26 05 00", title: "Common Work Results for Electrical" },
      { code: "26 20 00", title: "Low-Voltage Electrical Transmission" },
      { code: "26 30 00", title: "Facility Electrical Power Generating and Storing Equipment" },
      { code: "26 40 00", title: "Electrical and Cathodic Protection" },
      { code: "26 50 00", title: "Lighting" },
    ],
  },
  {
    id: "27",
    number: 27,
    title: "Communications",
    description: "Structured cabling, voice communications, data communications, and audio-video.",
    primarySections: [
      { code: "27 05 00", title: "Common Work Results for Communications" },
      { code: "27 10 00", title: "Structured Cabling" },
      { code: "27 20 00", title: "Data Communications" },
      { code: "27 30 00", title: "Voice Communications" },
      { code: "27 40 00", title: "Audio-Video Communications" },
      { code: "27 50 00", title: "Distributed Communications and Monitoring Systems" },
    ],
  },
  {
    id: "28",
    number: 28,
    title: "Electronic Safety and Security",
    description: "Electronic access control, intrusion detection, fire detection, and video surveillance.",
    primarySections: [
      { code: "28 05 00", title: "Common Work Results for Electronic Safety and Security" },
      { code: "28 10 00", title: "Electronic Access Control and Intrusion Detection" },
      { code: "28 20 00", title: "Electronic Surveillance" },
      { code: "28 30 00", title: "Electronic Detection and Alarm" },
      { code: "28 40 00", title: "Electronic Monitoring and Control" },
    ],
  },
  {
    id: "31",
    number: 31,
    title: "Earthwork",
    description: "Site clearing, grading, excavation, fill, soil stabilization, and erosion control.",
    primarySections: [
      { code: "31 10 00", title: "Site Clearing" },
      { code: "31 20 00", title: "Earth Moving" },
      { code: "31 30 00", title: "Earthwork Methods" },
      { code: "31 40 00", title: "Shoring and Underpinning" },
      { code: "31 50 00", title: "Excavation Support and Protection" },
      { code: "31 60 00", title: "Special Foundations and Load-Bearing Elements" },
    ],
  },
  {
    id: "32",
    number: 32,
    title: "Exterior Improvements",
    description: "Bases, ballasts, and paving; site improvements; planting; and irrigation.",
    primarySections: [
      { code: "32 10 00", title: "Bases, Ballasts, and Paving" },
      { code: "32 30 00", title: "Site Improvements" },
      { code: "32 70 00", title: "Wetlands" },
      { code: "32 80 00", title: "Irrigation" },
      { code: "32 90 00", title: "Planting" },
    ],
  },
  {
    id: "33",
    number: 33,
    title: "Utilities",
    description: "Water utility distribution, sanitary sewerage, storm drainage, and electrical utility transmission.",
    primarySections: [
      { code: "33 10 00", title: "Water Utilities" },
      { code: "33 20 00", title: "Wells" },
      { code: "33 30 00", title: "Sanitary Sewerage Utilities" },
      { code: "33 40 00", title: "Storm Drainage Utilities" },
      { code: "33 50 00", title: "Fuel Distribution Utilities" },
      { code: "33 70 00", title: "Electrical Utilities" },
      { code: "33 80 00", title: "Communications Utilities" },
    ],
  },
  {
    id: "34",
    number: 34,
    title: "Transportation",
    description: "Roads, bridges, railways, and air transportation facilities.",
    primarySections: [
      { code: "34 10 00", title: "Guideways/Railways" },
      { code: "34 20 00", title: "Traction Power" },
      { code: "34 40 00", title: "Transportation Signaling and Control Equipment" },
      { code: "34 70 00", title: "Fare Collection Equipment" },
      { code: "34 80 00", title: "Bridges" },
    ],
  },
  {
    id: "35",
    number: 35,
    title: "Waterway and Marine Construction",
    description: "Waterway construction, dredging, marine construction, and shoreline protection.",
    primarySections: [
      { code: "35 10 00", title: "Waterway and Marine Construction and Equipment" },
      { code: "35 20 00", title: "Waterway Construction and Equipment" },
      { code: "35 30 00", title: "Coastal Construction" },
      { code: "35 40 00", title: "Waterway Remediation" },
      { code: "35 50 00", title: "Marine Construction and Equipment" },
    ],
  },
  {
    id: "40",
    number: 40,
    title: "Process Integration",
    description: "Gas and vapor process piping, liquid process piping, and process instrumentation.",
    primarySections: [
      { code: "40 05 00", title: "Common Work Results for Process Integration" },
      { code: "40 10 00", title: "Gas and Vapor Process Piping" },
      { code: "40 20 00", title: "Liquids Process Piping" },
      { code: "40 30 00", title: "Solid and Mixed Materials Piping and Chutes" },
      { code: "40 90 00", title: "Instrumentation and Control for Process Systems" },
    ],
  },
  {
    id: "41",
    number: 41,
    title: "Material Processing and Handling Equipment",
    description: "Bulk material processing equipment, conveyors, and overhead hoisting.",
    primarySections: [
      { code: "41 10 00", title: "Bulk Material Processing Equipment" },
      { code: "41 20 00", title: "Piece Material Handling Equipment" },
      { code: "41 30 00", title: "Manufacturing Equipment" },
      { code: "41 40 00", title: "Container Processing and Packaging Equipment" },
      { code: "41 50 00", title: "Material Storage" },
    ],
  },
  {
    id: "42",
    number: 42,
    title: "Process Heating, Cooling, and Drying Equipment",
    description: "Process heating, cooling, and drying equipment.",
    primarySections: [
      { code: "42 10 00", title: "Process Heating Equipment" },
      { code: "42 20 00", title: "Process Cooling Equipment" },
      { code: "42 30 00", title: "Process Drying Equipment" },
    ],
  },
  {
    id: "43",
    number: 43,
    title: "Gas and Liquid Handling, Purification, and Storage Equipment",
    description: "Gas and liquid purification, storage, and handling equipment.",
    primarySections: [
      { code: "43 10 00", title: "Gas Handling Equipment" },
      { code: "43 20 00", title: "Liquid Handling Equipment" },
      { code: "43 30 00", title: "Gas and Liquid Purification Equipment" },
      { code: "43 40 00", title: "Gas and Liquid Storage" },
    ],
  },
  {
    id: "44",
    number: 44,
    title: "Pollution and Waste Control Equipment",
    description: "Air pollution control, noise pollution control, and solid waste control.",
    primarySections: [
      { code: "44 10 00", title: "Air Pollution Control" },
      { code: "44 20 00", title: "Noise Pollution Control" },
      { code: "44 30 00", title: "Odor Control" },
      { code: "44 40 00", title: "Solid Waste Control, Reuse, and Remediation" },
      { code: "44 50 00", title: "Liquid Waste Control, Reuse, and Remediation" },
    ],
  },
  {
    id: "45",
    number: 45,
    title: "Industry-Specific Manufacturing Equipment",
    description: "Industry-specific manufacturing equipment for various sectors.",
    primarySections: [
      { code: "45 10 00", title: "Chemical and Pharmaceutical Equipment" },
      { code: "45 20 00", title: "Food, Beverage, and Tobacco Manufacturing Equipment" },
      { code: "45 30 00", title: "Semiconductor Manufacturing Equipment" },
      { code: "45 40 00", title: "Pulp and Paper Manufacturing Equipment" },
    ],
  },
  {
    id: "46",
    number: 46,
    title: "Water and Wastewater Equipment",
    description: "Water and wastewater treatment and handling equipment.",
    primarySections: [
      { code: "46 10 00", title: "Water and Wastewater Equipment and Chemicals" },
      { code: "46 20 00", title: "Water Treatment Equipment" },
      { code: "46 30 00", title: "Wastewater Treatment and Disposal Equipment" },
      { code: "46 40 00", title: "Water and Wastewater Piping" },
      { code: "46 50 00", title: "Packaged Water and Wastewater Treatment Equipment" },
    ],
  },
  {
    id: "48",
    number: 48,
    title: "Electrical Power Generation",
    description: "Power generation equipment including solar, wind, and fuel cell systems.",
    primarySections: [
      { code: "48 10 00", title: "Electrical Power Generation Equipment" },
      { code: "48 14 00", title: "Solar Energy Electrical Power Generation Equipment" },
      { code: "48 15 00", title: "Wind Energy Electrical Power Generation Equipment" },
      { code: "48 16 00", title: "Fuel Cell Electrical Power Generation Equipment" },
    ],
  },
];

const _divisionMap = new Map<string, CsiDivision>(
  CSI_DIVISIONS.map((div) => [div.id, div])
);

export function getDivision(id: string): CsiDivision | undefined {
  return _divisionMap.get(id.padStart(2, "0"));
}

export function validateDivisionId(id: string): boolean {
  return _divisionMap.has(id.padStart(2, "0"));
}

export function getAllDivisions(): CsiDivision[] {
  return [...CSI_DIVISIONS];
}

export function getDivisionTitle(id: string): string {
  const div = getDivision(id);
  return div ? `Division ${div.id} — ${div.title}` : `Division ${id}`;
}
