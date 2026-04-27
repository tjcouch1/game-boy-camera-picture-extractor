/**
 * TypeScript Type Reference for Additional Licenses
 *
 * This file documents the AugmentedLicense type used in the additional-licenses.json
 * and additional-licenses.schema.json files.
 *
 * The AugmentedLicense interface is defined in scripts/generate-licenses.ts
 */

/**
 * Represents a single license entry with metadata
 *
 * @example
 * ```json
 * {
 *   "name": "opencv.js",
 *   "version": "4.5.0",
 *   "licenses": "Apache-2.0",
 *   "copyright": "Copyright (C) 2000-2021, Intel Corporation",
 *   "licenseText": "Apache License Version 2.0...",
 *   "repository": "https://github.com/opencv/opencv.js",
 *   "url": "https://opencv.org/",
 *   "description": "JavaScript binding of OpenCV for web deployment",
 *   "publisher": "OpenCV Contributors",
 *   "email": "contact@opencv.org"
 * }
 * ```
 */
interface AugmentedLicense {
  /** Package/library name (Required) */
  name: string;

  /** Version string (Required) */
  version: string;

  /** License type(s) - single string or array of strings (Required)
   * @example "MIT"
   * @example "Apache-2.0"
   * @example ["MIT", "Apache-2.0"]
   */
  licenses: string | string[];

  /** Copyright statement extracted or manually specified (Required)
   * @example "Copyright (C) 2000-2021, Intel Corporation"
   * @example "Copyright (c) 2024 Your Name"
   */
  copyright: string;

  /** Full license text verbatim (Required) */
  licenseText: string;

  /** Repository URL (Optional) */
  repository?: string;

  /** Publisher/author name (Optional) */
  publisher?: string;

  /** Contact email address (Optional) */
  email?: string;

  /** Package website/URL (Optional) */
  url?: string;

  /** Package description (Optional) */
  description?: string;
}

/**
 * Shape of additional-licenses.json file
 *
 * The $schema field points to the JSON Schema validator:
 * @example
 * ```json
 * {
 *   "$schema": "./additional-licenses.schema.json",
 *   "additionalLicenses": [
 *     { AugmentedLicense },
 *     { AugmentedLicense }
 *   ]
 * }
 * ```
 */
interface AdditionalLicensesFile {
  /** JSON Schema reference for validation */
  $schema?: string;
  /** Array of additional license entries to include in the licenses page */
  additionalLicenses: AugmentedLicense[];
}

/**
 * Complete shape after merging in generate-licenses.ts
 *
 * The merging process:
 * 1. Load additional licenses from additional-licenses.json
 * 2. Prefix keys with "0_" to sort to top (e.g., "0_opencv-js")
 * 3. Load npm packages from license-checker
 * 4. Merge both into a single Record<string, AugmentedLicense>
 * 5. Generate HTML and write to licenses.json
 */
type MergedAugmentedLicenses = Record<string, AugmentedLicense>;

/**
 * Export examples for documentation
 */
export const EXAMPLE_AUGMENTED_LICENSE: AugmentedLicense = {
  name: "opencv.js",
  version: "4.5.0",
  licenses: "Apache-2.0",
  copyright: "Copyright (C) 2000-2021, Intel Corporation",
  licenseText:
    "Apache License\nVersion 2.0, January 2004\n\nTERMS AND CONDITIONS...",
  repository: "https://github.com/opencv/opencv.js",
  url: "https://opencv.org/",
  description: "JavaScript binding of OpenCV for web deployment",
  publisher: "OpenCV Contributors",
  email: "contact@opencv.org",
};

export const EXAMPLE_ADDITIONAL_LICENSES_FILE: AdditionalLicensesFile = {
  $schema: "./additional-licenses.schema.json",
  additionalLicenses: [
    {
      name: "opencv.js",
      version: "4.5.0",
      licenses: "Apache-2.0",
      copyright: "Copyright (C) 2000-2021, Intel Corporation",
      licenseText: "Apache License text...",
      repository: "https://github.com/opencv/opencv.js",
      url: "https://opencv.org/",
      description: "JavaScript binding of OpenCV for web deployment",
    },
    {
      name: "Game Boy Camera Frame Reference",
      version: "1.0.0",
      licenses: "MIT",
      copyright:
        "Copyright (c) 2024 Game Boy Camera Frame Project Contributors",
      licenseText: "MIT License text...",
      description:
        "Reference frame images and assets for Game Boy Camera screen calibration",
    },
  ],
};
