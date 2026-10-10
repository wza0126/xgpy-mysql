/*
 * mdb-reader v3.2.0 (MIT License, Copyright (c) 2020 Andi Paetzold)
 * https://github.com/mkaltner/mdb-reader
 *
 * 本文件是 mdb-reader 的 **打包产物**（esbuild --bundle --platform=node --format=cjs），
 * 内联了全部源码，**不依赖任何外部 npm 包**（仅用 node:zlib）。
 * 为什么要打包：交付物是 pkg 单文件 exe，而 pkg 不支持 ESM 依赖；
 * 打包成 CJS 后即可被 pkg 正常静态追踪。
 *
 * [XGPY patch] 相较上游改动两处：
 *   1) lib/node/codec-handler/create.js 去掉 Office 敏捷加密分支（不需要，且会引入 fast-xml-parser / 全套 crypto 依赖）
 *   2) lib/node/Table.js 暴露 definitionBuffer / database（供上层解析索引·主键与原始页）
 *      并让 lib/node/index.js 额外导出 Database / Table
 *
 * 重新生成方式见同目录 README.md。请勿手工编辑下方压缩代码。
 */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// entry.mjs
var entry_exports = {};
__export(entry_exports, {
  Database: () => Database,
  Table: () => Table,
  default: () => entry_default
});
module.exports = __toCommonJS(entry_exports);

// node_modules/mdb-reader/lib/node/SortOrder.js
var GENERAL_SORT_ORDER_VALUE = 1033;
var GENERAL_97_SORT_ORDER = Object.freeze({ value: GENERAL_SORT_ORDER_VALUE, version: -1 });
var GENERAL_LEGACY_SORT_ORDER = Object.freeze({ value: GENERAL_SORT_ORDER_VALUE, version: 0 });
var GENERAL_SORT_ORDER = Object.freeze({ value: GENERAL_SORT_ORDER_VALUE, version: 1 });

// node_modules/mdb-reader/lib/node/JetFormat/types.js
var CodecType;
(function(CodecType2) {
  CodecType2[CodecType2["JET"] = 0] = "JET";
  CodecType2[CodecType2["MSISAM"] = 1] = "MSISAM";
  CodecType2[CodecType2["OFFICE"] = 2] = "OFFICE";
})(CodecType || (CodecType = {}));

// node_modules/mdb-reader/lib/node/JetFormat/Jet4Format.js
var jet4Format = {
  codecType: CodecType.JET,
  pageSize: 4096,
  textEncoding: "ucs-2",
  defaultSortOrder: GENERAL_LEGACY_SORT_ORDER,
  databaseDefinitionPage: {
    encryptedSize: 128,
    passwordSize: 40,
    creationDateOffset: 114,
    // 114
    defaultSortOrder: {
      offset: 110,
      // 110
      size: 4
    }
  },
  dataPage: {
    recordCountOffset: 12,
    record: {
      countOffset: 12,
      columnCountSize: 2,
      variableColumnCountSize: 2
    }
  },
  tableDefinitionPage: {
    rowCountOffset: 16,
    variableColumnCountOffset: 43,
    columnCountOffset: 45,
    logicalIndexCountOffset: 47,
    realIndexCountOffset: 51,
    realIndexStartOffset: 63,
    realIndexEntrySize: 12,
    columnsDefinition: {
      typeOffset: 0,
      indexOffset: 5,
      variableIndexOffset: 7,
      flagsOffset: 15,
      fixedIndexOffset: 21,
      sizeOffset: 23,
      entrySize: 25,
      complexTypeIdOffset: 9
    },
    columnNames: {
      nameLengthSize: 2
    },
    usageMapOffset: 55
  }
};

// node_modules/mdb-reader/lib/node/JetFormat/Jet12Format.js
var jet12Format = {
  ...jet4Format,
  codecType: CodecType.OFFICE
};

// node_modules/mdb-reader/lib/node/JetFormat/Jet14Format.js
var jet14Format = {
  ...jet12Format,
  defaultSortOrder: GENERAL_SORT_ORDER
};

// node_modules/mdb-reader/lib/node/JetFormat/Jet15Format.js
var jet15Format = jet14Format;

// node_modules/mdb-reader/lib/node/JetFormat/Jet16Format.js
var jet16Format = jet15Format;

// node_modules/mdb-reader/lib/node/JetFormat/Jet17Format.js
var jet17Format = jet16Format;

// node_modules/mdb-reader/lib/node/JetFormat/Jet3Format.js
var jet3Format = {
  codecType: CodecType.JET,
  pageSize: 2048,
  textEncoding: "unknown",
  defaultSortOrder: GENERAL_97_SORT_ORDER,
  databaseDefinitionPage: {
    encryptedSize: 126,
    passwordSize: 20,
    creationDateOffset: null,
    defaultSortOrder: {
      offset: 58,
      // 58
      size: 2
    }
  },
  dataPage: {
    recordCountOffset: 8,
    record: {
      countOffset: 8,
      columnCountSize: 1,
      variableColumnCountSize: 1
    }
  },
  tableDefinitionPage: {
    rowCountOffset: 12,
    columnCountOffset: 25,
    variableColumnCountOffset: 23,
    logicalIndexCountOffset: 27,
    realIndexCountOffset: 31,
    realIndexStartOffset: 43,
    realIndexEntrySize: 8,
    columnsDefinition: {
      typeOffset: 0,
      indexOffset: 1,
      variableIndexOffset: 3,
      flagsOffset: 13,
      fixedIndexOffset: 14,
      sizeOffset: 16,
      entrySize: 18
    },
    columnNames: {
      nameLengthSize: 1
    },
    usageMapOffset: 35
  }
};

// node_modules/mdb-reader/lib/node/JetFormat/MSISAMFormat.js
var msisamFormat = {
  ...jet4Format,
  codecType: CodecType.MSISAM
};

// node_modules/mdb-reader/lib/node/JetFormat/index.js
var OFFSET_VERSION = 20;
var OFFSET_ENGINE_NAME = 4;
var MSISAM_ENGINE = "MSISAM Database";
function getJetFormat(buffer) {
  const version = buffer[OFFSET_VERSION];
  switch (version) {
    case 0:
      return jet3Format;
    case 1:
      if (buffer.slice(OFFSET_ENGINE_NAME, OFFSET_ENGINE_NAME + MSISAM_ENGINE.length).toString("ascii") === MSISAM_ENGINE) {
        return msisamFormat;
      }
      return jet4Format;
    case 2:
      return jet12Format;
    case 3:
      return jet14Format;
    case 4:
      return jet15Format;
    case 5:
      return jet16Format;
    case 6:
      return jet17Format;
    default:
      throw new Error(`Unsupported version '${version}'`);
  }
}

// node_modules/mdb-reader/lib/node/codec-handler/handlers/identity.js
function createIdentityHandler() {
  return {
    decryptPage: (b) => b,
    verifyPassword: () => true
  };
}

// node_modules/mdb-reader/lib/node/environment/index.js
var import_node_zlib = require("node:zlib");
var environment = {
  inflate: (data) => (0, import_node_zlib.inflateSync)(data)
};

// node_modules/mdb-reader/lib/node/util.js
function getBitmapValue(bitmap, pos) {
  const byteNumber = Math.floor(pos / 8);
  const bitNumber = pos % 8;
  return !!(bitmap[byteNumber] & 1 << bitNumber);
}
function roundToFullByte(bits) {
  return Math.floor((bits + 7) / 8);
}
function xor(a, b) {
  const length = Math.max(a.length, b.length);
  const buffer = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = a[i] ^ b[i];
  }
  return buffer;
}
function isEmptyBuffer(buffer) {
  return buffer.every((v) => v === 0);
}
function maskTableId(id) {
  return id & 16777215;
}

// node_modules/mdb-reader/lib/node/crypto/rc4.js
function decryptRC4(key, data) {
  const decrypt = createRC4Decrypter(key);
  return decrypt(data);
}
function createRC4Decrypter(key) {
  const S = createKeyStream(key);
  let i = 0;
  let j = 0;
  return (data) => {
    const resultBuffer = Buffer.from(data);
    for (let k = 0; k < data.length; ++k) {
      i = (i + 1) % 256;
      j = (j + S[i]) % 256;
      [S[i], S[j]] = [S[j], S[i]];
      resultBuffer[k] ^= S[(S[i] + S[j]) % 256];
    }
    return resultBuffer;
  };
}
function createKeyStream(key) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; ++i) {
    S[i] = i;
  }
  let j = 0;
  for (let i = 0; i < 256; ++i) {
    j = (j + S[i] + key[i % key.length]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
  }
  return S;
}

// node_modules/mdb-reader/lib/node/codec-handler/util.js
function getPageEncodingKey(encodingKey, pageNumber) {
  const pageIndexBuffer = Buffer.alloc(4);
  pageIndexBuffer.writeUInt32LE(pageNumber);
  return xor(pageIndexBuffer, encodingKey);
}

// node_modules/mdb-reader/lib/node/codec-handler/handlers/jet.js
var KEY_OFFSET = 62;
var KEY_SIZE = 4;
function createJetCodecHandler(databaseDefinitionPage) {
  const encodingKey = databaseDefinitionPage.slice(KEY_OFFSET, KEY_OFFSET + KEY_SIZE);
  if (isEmptyBuffer(encodingKey)) {
    return createIdentityHandler();
  }
  const decryptPage = (pageBuffer, pageIndex) => {
    const pagekey = getPageEncodingKey(encodingKey, pageIndex);
    return decryptRC4(pagekey, pageBuffer);
  };
  return {
    decryptPage,
    verifyPassword: () => true
    // TODO
  };
}

// node_modules/mdb-reader/lib/node/codec-handler/create.js
function createCodecHandler(databaseDefinitionPage, password) {
  const format2 = getJetFormat(databaseDefinitionPage);
  switch (format2.codecType) {
    case CodecType.JET:
      return createJetCodecHandler(databaseDefinitionPage);
    default:
      return createIdentityHandler();
  }
}

// node_modules/mdb-reader/lib/node/data/datetime.js
function readDateTime(buffer) {
  const td = buffer.readDoubleLE();
  const daysDiff = 25569;
  return new Date(Math.round((td - daysDiff) * 86400 * 1e3));
}

// node_modules/mdb-reader/lib/node/PageType.js
var PageType;
(function(PageType2) {
  PageType2[PageType2["DatabaseDefinitionPage"] = 0] = "DatabaseDefinitionPage";
  PageType2[PageType2["DataPage"] = 1] = "DataPage";
  PageType2[PageType2["TableDefinition"] = 2] = "TableDefinition";
  PageType2[PageType2["IntermediateIndexPage"] = 3] = "IntermediateIndexPage";
  PageType2[PageType2["LeafIndexPages"] = 4] = "LeafIndexPages";
  PageType2[PageType2["PageUsageBitmaps"] = 5] = "PageUsageBitmaps";
})(PageType || (PageType = {}));
function assertPageType(buffer, pageType) {
  if (buffer[0] !== pageType) {
    throw new Error(`Wrong page type. Expected ${pageType} but received ${buffer[0]}.`);
  }
}

// node_modules/mdb-reader/lib/node/dependencies/iconv-lite/index.js
var ASCII_CHARS = Array.from({ length: 128 }).map((_, i) => String.fromCharCode(i)).join("");
var WINDOWS_1252_CHARS = "\u20AC\uFFFD\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\uFFFD\u017D\uFFFD\uFFFD\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\uFFFD\u017E\u0178\xA0\xA1\xA2\xA3\xA4\xA5\xA6\xA7\xA8\xA9\xAA\xAB\xAC\xAD\xAE\xAF\xB0\xB1\xB2\xB3\xB4\xB5\xB6\xB7\xB8\xB9\xBA\xBB\xBC\xBD\xBE\xBF\xC0\xC1\xC2\xC3\xC4\xC5\xC6\xC7\xC8\xC9\xCA\xCB\xCC\xCD\xCE\xCF\xD0\xD1\xD2\xD3\xD4\xD5\xD6\xD7\xD8\xD9\xDA\xDB\xDC\xDD\xDE\xDF\xE0\xE1\xE2\xE3\xE4\xE5\xE6\xE7\xE8\xE9\xEA\xEB\xEC\xED\xEE\xEF\xF0\xF1\xF2\xF3\xF4\xF5\xF6\xF7\xF8\xF9\xFA\xFB\xFC\xFD\xFE\xFF";
function decodeWindows1252(buffer) {
  const chars = `${ASCII_CHARS}${WINDOWS_1252_CHARS}`;
  const charsBuffer = Buffer.from(chars, "ucs2");
  const result = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length; ++i) {
    const index = buffer[i] * 2;
    result[i * 2] = charsBuffer[index];
    result[i * 2 + 1] = charsBuffer[index + 1];
  }
  return result.toString("ucs2");
}

// node_modules/mdb-reader/lib/node/unicodeCompression.js
function uncompressText(buffer, format2) {
  if (format2.textEncoding === "unknown") {
    return decodeWindows1252(buffer);
  }
  if (buffer.length <= 2 || (buffer.readUInt8(0) & 255) !== 255 || (buffer.readUInt8(1) & 255) !== 254) {
    return buffer.toString("ucs-2");
  }
  let compressedMode = true;
  let curPos = 2;
  const uncompressedBuffer = Buffer.alloc((buffer.length - curPos) * 2);
  let uncompressedBufferPos = 0;
  while (curPos < buffer.length) {
    if (buffer.readUInt8(curPos) === 0) {
      compressedMode = !compressedMode;
      curPos++;
    } else if (compressedMode) {
      uncompressedBuffer[uncompressedBufferPos++] = buffer.readUInt8(curPos++);
      uncompressedBuffer[uncompressedBufferPos++] = 0;
    } else if (buffer.length - curPos >= 2) {
      uncompressedBuffer[uncompressedBufferPos++] = buffer.readUInt8(curPos++);
      uncompressedBuffer[uncompressedBufferPos++] = buffer.readUInt8(curPos++);
    } else {
      break;
    }
  }
  return uncompressedBuffer.slice(0, uncompressedBufferPos).toString("ucs-2");
}

// node_modules/mdb-reader/lib/node/Database.js
var PASSWORD_OFFSET = 66;
var Database = class {
  #buffer;
  #format;
  #codecHandler;
  #databaseDefinitionPage;
  constructor(buffer, password) {
    this.#buffer = buffer;
    assertPageType(this.#buffer, PageType.DatabaseDefinitionPage);
    this.#format = getJetFormat(this.#buffer);
    this.#databaseDefinitionPage = Buffer.alloc(this.#format.pageSize);
    this.#buffer.copy(this.#databaseDefinitionPage, 0, 0, this.#format.pageSize);
    decryptHeader(this.#databaseDefinitionPage, this.#format);
    this.#codecHandler = createCodecHandler(this.#databaseDefinitionPage, password);
    if (!this.#codecHandler.verifyPassword()) {
      throw new Error("Wrong password");
    }
  }
  get format() {
    return this.#format;
  }
  getPassword() {
    let passwordBuffer = this.#databaseDefinitionPage.slice(PASSWORD_OFFSET, PASSWORD_OFFSET + this.#format.databaseDefinitionPage.passwordSize);
    const mask = this.#getPasswordMask();
    if (mask !== null) {
      passwordBuffer = xor(passwordBuffer, mask);
    }
    if (isEmptyBuffer(passwordBuffer)) {
      return null;
    }
    let password = uncompressText(passwordBuffer, this.#format);
    const nullCharIndex = password.indexOf("\0");
    if (nullCharIndex >= 0) {
      password = password.slice(0, nullCharIndex);
    }
    return password;
  }
  #getPasswordMask() {
    if (this.#format.databaseDefinitionPage.creationDateOffset === null) {
      return null;
    }
    const mask = Buffer.alloc(this.#format.databaseDefinitionPage.passwordSize);
    const dateValue = this.#databaseDefinitionPage.readDoubleLE(this.#format.databaseDefinitionPage.creationDateOffset);
    mask.writeInt32LE(Math.floor(dateValue));
    for (let i = 0; i < mask.length; ++i) {
      mask[i] = mask[i % 4];
    }
    return mask;
  }
  getCreationDate() {
    if (this.#format.databaseDefinitionPage.creationDateOffset === null) {
      return null;
    }
    const creationDateBuffer = this.#databaseDefinitionPage.slice(this.#format.databaseDefinitionPage.creationDateOffset, this.#format.databaseDefinitionPage.creationDateOffset + 8);
    return readDateTime(creationDateBuffer);
  }
  getDefaultSortOrder() {
    const value = this.#databaseDefinitionPage.readUInt16LE(this.#format.databaseDefinitionPage.defaultSortOrder.offset + 3);
    if (value === 0) {
      return this.#format.defaultSortOrder;
    }
    let version = this.#format.defaultSortOrder.version;
    if (this.#format.databaseDefinitionPage.defaultSortOrder.size == 4) {
      version = this.#databaseDefinitionPage.readUInt8(this.#format.databaseDefinitionPage.defaultSortOrder.offset + 3);
    }
    return Object.freeze({ value, version });
  }
  getPage(page) {
    if (page === 0) {
      return this.#databaseDefinitionPage;
    }
    const offset = page * this.#format.pageSize;
    if (this.#buffer.length < offset) {
      throw new Error(`Page ${page} does not exist`);
    }
    const pageBuffer = this.#buffer.slice(offset, offset + this.#format.pageSize);
    return this.#codecHandler.decryptPage(pageBuffer, page);
  }
  /**
   * @param pageRow Lower byte contains the row number, the upper three contain page
   *
   * @see https://github.com/brianb/mdbtools/blob/d6f5745d949f37db969d5f424e69b54f0da60b9b/src/libmdb/data.c#L102-L124
   */
  findPageRow(pageRow) {
    const page = pageRow >> 8;
    const row = pageRow & 255;
    const pageBuffer = this.getPage(page);
    return this.findRow(pageBuffer, row);
  }
  /**
   * @param pageBuffer Buffer of a data page
   *
   * @see https://github.com/brianb/mdbtools/blob/d6f5745d949f37db969d5f424e69b54f0da60b9b/src/libmdb/data.c#L126-L138
   */
  findRow(pageBuffer, row) {
    const rco = this.#format.dataPage.recordCountOffset;
    if (row > 1e3) {
      throw new Error("Cannot read rows > 1000");
    }
    const start = pageBuffer.readUInt16LE(rco + 2 + row * 2);
    const nextStart = row === 0 ? this.#format.pageSize : pageBuffer.readUInt16LE(rco + row * 2);
    return pageBuffer.slice(start, nextStart);
  }
};
var ENCRYPTION_START = 24;
var ENCRYPTION_KEY = [199, 218, 57, 107];
function decryptHeader(buffer, format2) {
  const decryptedBuffer = decryptRC4(Buffer.from(ENCRYPTION_KEY), buffer.slice(ENCRYPTION_START, ENCRYPTION_START + format2.databaseDefinitionPage.encryptedSize));
  decryptedBuffer.copy(buffer, ENCRYPTION_START);
}

// node_modules/mdb-reader/lib/node/SysObject.js
var SysObjectTypes = {
  Form: 0,
  Table: 1,
  Macro: 2,
  SystemTable: 3,
  Report: 4,
  Query: 5,
  LinkedTable: 6,
  Module: 7,
  Relationship: 8,
  DatabaseProperty: 11
};
function isSysObjectType(typeValue) {
  return Object.values(SysObjectTypes).includes(typeValue);
}
var SYSTEM_OBJECT_FLAG = 2147483648;
var ALT_SYSTEM_OBJECT_FLAG = 2;
var SYSTEM_OBJECT_FLAGS = SYSTEM_OBJECT_FLAG | ALT_SYSTEM_OBJECT_FLAG;
function isSystemObject(o) {
  return (o.flags & SYSTEM_OBJECT_FLAGS) !== 0;
}

// node_modules/mdb-reader/lib/node/types.js
var ColumnTypes = {
  Boolean: "boolean",
  Byte: "byte",
  Integer: "integer",
  Long: "long",
  Currency: "currency",
  Float: "float",
  Double: "double",
  DateTime: "datetime",
  Binary: "binary",
  Text: "text",
  OLE: "ole",
  Memo: "memo",
  RepID: "repid",
  Numeric: "numeric",
  Complex: "complex",
  BigInt: "bigint",
  DateTimeExtended: "datetimextended"
};

// node_modules/mdb-reader/lib/node/column.js
var columnTypeMap = {
  1: ColumnTypes.Boolean,
  2: ColumnTypes.Byte,
  3: ColumnTypes.Integer,
  4: ColumnTypes.Long,
  5: ColumnTypes.Currency,
  6: ColumnTypes.Float,
  7: ColumnTypes.Double,
  8: ColumnTypes.DateTime,
  9: ColumnTypes.Binary,
  10: ColumnTypes.Text,
  11: ColumnTypes.OLE,
  12: ColumnTypes.Memo,
  15: ColumnTypes.RepID,
  16: ColumnTypes.Numeric,
  18: ColumnTypes.Complex,
  19: ColumnTypes.BigInt,
  20: ColumnTypes.DateTimeExtended
};
function getColumnType(typeValue) {
  const type = columnTypeMap[typeValue];
  if (type === void 0) {
    throw new Error("Unsupported column type");
  }
  return type;
}
function parseColumnFlags(flags) {
  return {
    fixedLength: !!(flags & 1),
    nullable: !!(flags & 2),
    autoLong: !!(flags & 4),
    autoUUID: !!(flags & 64)
  };
}

// node_modules/mdb-reader/lib/node/data/bigint.js
function readBigInt(buffer) {
  return buffer.readBigInt64LE();
}

// node_modules/mdb-reader/lib/node/data/binary.js
function readBinary(buffer) {
  const result = Buffer.alloc(buffer.length);
  buffer.copy(result);
  return result;
}

// node_modules/mdb-reader/lib/node/data/byte.js
function readByte(buffer) {
  return buffer.readUInt8();
}

// node_modules/mdb-reader/lib/node/data/complex/attachment.js
var DATA_TYPES = {
  RAW: 0,
  COMPRESSED: 1
};
function decodeAttachmentFileData(buffer) {
  if (buffer.length < 8) {
    throw new Error("Unknown encoded attachment data format");
  }
  const typeFlag = buffer.readInt32LE(0);
  const dataLen = buffer.readInt32LE(4);
  let content = buffer.subarray(8);
  switch (typeFlag) {
    case DATA_TYPES.COMPRESSED:
      content = environment.inflate(content);
      break;
    case DATA_TYPES.RAW:
      break;
    default:
      throw new Error(`Unknown encoded attachment data type ${typeFlag}`);
  }
  if (content.length < 4) {
    throw new Error("Invalid attachment content header");
  }
  const headerLen = content.readInt32LE(0);
  if (headerLen < 4 || headerLen > content.length) {
    throw new Error("Invalid attachment header length");
  }
  const payloadEnd = Math.min(dataLen, content.length);
  if (headerLen >= payloadEnd) {
    throw new Error("Invalid attachment header length");
  }
  return content.subarray(headerLen, payloadEnd);
}

// node_modules/mdb-reader/lib/node/systemTables.js
function getMSysObjectsTable(database) {
  return new Table("MSysObjects", database, 2);
}

// node_modules/mdb-reader/lib/node/data/complex/complexColumnsData.js
var MSYS_COMPLEX_COLUMNS_TABLE = "MSysComplexColumns";
function getMsysComplexColumnsPage(database) {
  const msysObjectsData = getMSysObjectsTable(database).getData({
    columns: ["Id", "Name"]
  });
  const complexColRow = msysObjectsData.find((r) => r.Name === MSYS_COMPLEX_COLUMNS_TABLE);
  if (!complexColRow) {
    throw new Error(`MSysComplexColumns table not found in MSysObjects table`);
  }
  return maskTableId(complexColRow.Id);
}
function getComplexColumnsData(database) {
  const msysComplexColumnsPage = getMsysComplexColumnsPage(database);
  const msysComplexColumns = new Table(MSYS_COMPLEX_COLUMNS_TABLE, database, msysComplexColumnsPage);
  return msysComplexColumns.getData();
}

// node_modules/mdb-reader/lib/node/data/complex/utils.js
function resolveFlatTableForComplexColumn(database, column) {
  const msysObjectsData = getMSysObjectsTable(database).getData({
    columns: ["Id", "Name"]
  });
  const complexColsData = getComplexColumnsData(database);
  const tableDefPageMasked = maskTableId(column.complex.tableDefinitionPage);
  for (const row of complexColsData) {
    const rowFlatTableId = row.FlatTableID;
    if (!rowFlatTableId) {
      continue;
    }
    const rowConceptualTableId = row.ConceptualTableID;
    const tableMatch = typeof rowConceptualTableId === "number" && rowConceptualTableId === tableDefPageMasked;
    if (!tableMatch) {
      continue;
    }
    const complexTypeIdMatch = typeof row.ComplexTypeObjectID === "number" && row.ComplexTypeObjectID === column.complex.typeId;
    const complexIdMatch = typeof row.ComplexID === "number" && row.ComplexID === column.complex.typeId;
    const columnNameMatch = typeof row.ColumnName === "string" && row.ColumnName.toLowerCase() === column.name.toLowerCase();
    if (!complexTypeIdMatch && !complexIdMatch && !columnNameMatch) {
      continue;
    }
    const flatTableId = maskTableId(rowFlatTableId);
    const flatTableRow = msysObjectsData.find((r) => maskTableId(r.Id) === flatTableId);
    if (!flatTableRow) {
      throw new Error(`Flat table not found for complex column ${column.name}`);
    }
    return {
      tableName: flatTableRow.Name,
      firstPage: flatTableId
    };
  }
  throw new Error(`Flat table not found for complex column ${column.name}`);
}

// node_modules/mdb-reader/lib/node/data/complex/index.js
var ATTACHMENT_TYPE_COLUMN_NAMES = /* @__PURE__ */ new Set([
  "FileName",
  "FileType",
  "FileData",
  "FileURL",
  "FileTimeStamp",
  "FileFlags"
]);
function readComplex(buffer, column, database) {
  try {
    const complexTypeId = column.complex?.typeId;
    const tableDefinitionPage = column.complex?.tableDefinitionPage;
    if (complexTypeId === void 0 || tableDefinitionPage === void 0) {
      throw new Error("Complex column is not valid");
    }
    const complexColumnDefinition = {
      ...column,
      complex: {
        typeId: complexTypeId,
        tableDefinitionPage
      }
    };
    const foreignKey = buffer.readInt32LE(0);
    if (foreignKey <= 0) {
      throw new Error("Foreign key value is not valid");
    }
    const { tableName: flatTableName, firstPage: flatTableFirstPage } = resolveFlatTableForComplexColumn(database, complexColumnDefinition);
    const flatTable = new Table(flatTableName, database, flatTableFirstPage);
    const foreignKeyColumn = flatTable.getColumns().find((c) => c.type === ColumnTypes.Long && !c.autoLong && !ATTACHMENT_TYPE_COLUMN_NAMES.has(c.name));
    if (!foreignKeyColumn) {
      throw new Error("Foreign key column not found");
    }
    const flatData = flatTable.getData();
    const matchingRows = flatData.filter((row) => row[foreignKeyColumn.name] === foreignKey);
    return matchingRows.map((row) => {
      const attachment = {
        name: row.FileName,
        type: row.FileType,
        data: decodeAttachmentFileData(row.FileData)
      };
      if (row.FileURL) {
        attachment.url = row.FileURL;
      }
      if (row.FileTimeStamp) {
        attachment.timestamp = row.FileTimeStamp;
      }
      if (row.FileFlags) {
        attachment.flags = row.FileFlags;
      }
      return attachment;
    });
  } catch (error) {
    throw new Error("Failed to read complex column", { cause: error });
  }
}

// node_modules/mdb-reader/lib/node/array.js
function doCarry(values) {
  const result = [...values];
  const length = result.length;
  for (let i = 0; i < length - 1; ++i) {
    result[i + 1] += Math.floor(result[i] / 10);
    result[i] %= 10;
  }
  result[length - 1] %= 10;
  return result;
}
function multiplyArray(a, b) {
  if (a.length !== b.length) {
    throw new Error("Array a and b must have the same length");
  }
  const result = new Array(a.length).fill(0);
  for (let i = 0; i < a.length; ++i) {
    if (a[i] === 0)
      continue;
    for (let j = 0; j < b.length; j++) {
      result[i + j] += a[i] * b[j];
    }
  }
  return doCarry(result.slice(0, a.length));
}
function addArray(a, b) {
  if (a.length !== b.length) {
    throw new Error("Array a and b must have the same length");
  }
  const length = a.length;
  const result = [];
  for (let i = 0; i < length; ++i) {
    result[i] = a[i] + b[i];
  }
  return doCarry(result);
}
function toArray(v, length) {
  return doCarry([v, ...new Array(length - 1).fill(0)]);
}

// node_modules/mdb-reader/lib/node/data/util.js
function buildValue(array, scale, negative) {
  const length = array.length;
  let value = "";
  if (negative) {
    value += "-";
  }
  let top = length;
  while (top > 0 && top - 1 > scale && !array[top - 1]) {
    top--;
  }
  if (top === 0) {
    value += "0";
  } else {
    for (let i = top; i > 0; i--) {
      if (i === scale) {
        value += ".";
      }
      value += array[i - 1].toString();
    }
  }
  return value;
}

// node_modules/mdb-reader/lib/node/data/currency.js
var MAX_PRECISION = 20;
function readCurrency(buffer) {
  const bytesCount = 8;
  const scale = 4;
  let product = toArray(0, MAX_PRECISION);
  let multiplier = toArray(1, MAX_PRECISION);
  const bytes = buffer.slice(0, bytesCount);
  let negative = false;
  if (bytes[bytesCount - 1] & 128) {
    negative = true;
    for (let i = 0; i < bytesCount; ++i) {
      bytes[i] = ~bytes[i];
    }
    for (let i = 0; i < bytesCount; ++i) {
      ++bytes[i];
      if (bytes[i] != 0) {
        break;
      }
    }
  }
  for (const byte of bytes) {
    product = addArray(product, multiplyArray(multiplier, toArray(byte, MAX_PRECISION)));
    multiplier = multiplyArray(multiplier, toArray(256, MAX_PRECISION));
  }
  return buildValue(product, scale, negative);
}

// node_modules/mdb-reader/lib/node/data/datetimextended.js
var DAYS_START = 0;
var DAYS_LENGTH = 19;
var SECONDS_START = DAYS_START + DAYS_LENGTH + 1;
var SECONDS_LENGTH = 12;
var NANOS_START = SECONDS_START + SECONDS_LENGTH;
var NANOS_LENGTH = 7;
function readDateTimeExtended(buffer) {
  const days = parseBigInt(buffer.slice(DAYS_START, DAYS_START + DAYS_LENGTH));
  const seconds = parseBigInt(buffer.slice(SECONDS_START, SECONDS_START + SECONDS_LENGTH));
  const nanos = parseBigInt(buffer.slice(NANOS_START, NANOS_START + NANOS_LENGTH)) * 100n;
  return format(days, seconds, nanos);
}
function parseBigInt(buffer) {
  return BigInt(buffer.toString("ascii"));
}
function format(days, seconds, nanos) {
  const date = /* @__PURE__ */ new Date(0);
  date.setUTCFullYear(1);
  date.setUTCDate(date.getUTCDate() + Number(days));
  date.setUTCSeconds(date.getUTCSeconds() + Number(seconds));
  let result = "";
  result += date.getFullYear().toString().padStart(4, "0");
  result += `.${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
  result += `.${date.getUTCDate().toString().padStart(2, "0")}`;
  result += ` ${date.getUTCHours().toString().padStart(2, "0")}`;
  result += `:${date.getUTCMinutes().toString().padStart(2, "0")}`;
  result += `:${date.getUTCSeconds().toString().padStart(2, "0")}`;
  result += `.${nanos.toString().padStart(9, "0")}`;
  return result;
}

// node_modules/mdb-reader/lib/node/data/double.js
function readDouble(buffer) {
  return buffer.readDoubleLE();
}

// node_modules/mdb-reader/lib/node/data/float.js
function readFloat(buffer) {
  return buffer.readFloatLE();
}

// node_modules/mdb-reader/lib/node/data/integer.js
function readInteger(buffer) {
  return buffer.readInt16LE();
}

// node_modules/mdb-reader/lib/node/data/memo.js
var TYPE_THIS_PAGE = 128;
var TYPE_OTHER_PAGE = 64;
var TYPE_OTHER_PAGES = 0;
function readMemo(buffer, _col, database) {
  const memoLength = buffer.readUIntLE(0, 3);
  const type = buffer.readUInt8(3);
  switch (type) {
    case TYPE_THIS_PAGE: {
      const compressedText = buffer.slice(12, 12 + memoLength);
      return uncompressText(compressedText, database.format);
    }
    case TYPE_OTHER_PAGE: {
      const pageRow = buffer.readUInt32LE(4);
      const rowBuffer = database.findPageRow(pageRow);
      const compressedText = rowBuffer.slice(0, memoLength);
      return uncompressText(compressedText, database.format);
    }
    case TYPE_OTHER_PAGES: {
      let pageRow = buffer.readInt32LE(4);
      let memoDataBuffer = Buffer.alloc(0);
      do {
        const rowBuffer = database.findPageRow(pageRow);
        if (memoDataBuffer.length + rowBuffer.length - 4 > memoLength) {
          break;
        }
        if (rowBuffer.length === 0) {
          break;
        }
        memoDataBuffer = Buffer.concat([memoDataBuffer, rowBuffer.slice(4)]);
        pageRow = rowBuffer.readInt32LE(0);
      } while (pageRow !== 0);
      const compressedText = memoDataBuffer.slice(0, memoLength);
      return uncompressText(compressedText, database.format);
    }
    default:
      throw new Error(`Unknown memo type ${type}`);
  }
}

// node_modules/mdb-reader/lib/node/data/numeric.js
var MAX_PRECISION2 = 40;
function readNumeric(buffer, column) {
  let product = toArray(0, MAX_PRECISION2);
  let multiplier = toArray(1, MAX_PRECISION2);
  const bytes = buffer.slice(1, 17);
  for (let i = 0; i < bytes.length; ++i) {
    const byte = bytes[12 - 4 * Math.floor(i / 4) + i % 4];
    product = addArray(product, multiplyArray(multiplier, toArray(byte, MAX_PRECISION2)));
    multiplier = multiplyArray(multiplier, toArray(256, MAX_PRECISION2));
  }
  const negative = !!(buffer[0] & 128);
  return buildValue(
    product,
    // Scale is always set for numeric columns
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    column.scale,
    negative
  );
}

// node_modules/mdb-reader/lib/node/data/ole.js
var TYPES = {
  THIS_PAGE: 128,
  OTHER_PAGE: 64,
  OTHER_PAGES: 0
};
function readOLE(buffer, _col, database) {
  const length = buffer.readUIntLE(0, 3);
  const type = buffer.readUInt8(3);
  switch (type) {
    case TYPES.THIS_PAGE: {
      return buffer.slice(12, 12 + length);
    }
    case TYPES.OTHER_PAGE: {
      const pageRow = buffer.readUInt32LE(4);
      const rowBuffer = database.findPageRow(pageRow);
      return rowBuffer.slice(0, length);
    }
    case TYPES.OTHER_PAGES: {
      let pageRow = buffer.readInt32LE(4);
      const result = Buffer.alloc(length);
      let offset = 0;
      do {
        const rowBuffer = database.findPageRow(pageRow);
        if (rowBuffer.length <= 4) {
          break;
        }
        pageRow = rowBuffer.readUInt32LE(0);
        const newChunk = rowBuffer.subarray(4);
        newChunk.copy(result, offset);
        offset += newChunk.length;
      } while (pageRow !== 0);
      return result.subarray(0, length);
    }
    default: {
      throw new Error(`Unknown OLE type ${type}`);
    }
  }
}

// node_modules/mdb-reader/lib/node/data/repid.js
function readRepID(buffer) {
  return buffer.slice(0, 4).swap32().toString("hex") + // swap for little-endian
  "-" + buffer.slice(4, 6).swap16().toString("hex") + // swap for little-endian
  "-" + buffer.slice(6, 8).swap16().toString("hex") + // swap for little-endian
  "-" + buffer.slice(8, 10).toString("hex") + // big-endian
  "-" + buffer.slice(10, 16).toString("hex");
}

// node_modules/mdb-reader/lib/node/data/text.js
function readText(buffer, _col, database) {
  return uncompressText(buffer, database.format);
}

// node_modules/mdb-reader/lib/node/data/long.js
function readLong(buffer, _column, _database) {
  return buffer.readInt32LE(0);
}

// node_modules/mdb-reader/lib/node/data/index.js
var readFnByColType = {
  [ColumnTypes.BigInt]: readBigInt,
  [ColumnTypes.Binary]: readBinary,
  [ColumnTypes.Byte]: readByte,
  [ColumnTypes.Complex]: readComplex,
  [ColumnTypes.Currency]: readCurrency,
  [ColumnTypes.DateTime]: readDateTime,
  [ColumnTypes.DateTimeExtended]: readDateTimeExtended,
  [ColumnTypes.Double]: readDouble,
  [ColumnTypes.Float]: readFloat,
  [ColumnTypes.Integer]: readInteger,
  [ColumnTypes.Long]: readLong,
  [ColumnTypes.Text]: readText,
  [ColumnTypes.Memo]: readMemo,
  [ColumnTypes.Numeric]: readNumeric,
  [ColumnTypes.OLE]: readOLE,
  [ColumnTypes.RepID]: readRepID
};
function readFieldValue(buffer, column, database) {
  if (column.type === ColumnTypes.Boolean) {
    throw new Error("readFieldValue does not handle type boolean");
  }
  const read = readFnByColType[column.type];
  if (!read) {
    return `Column type ${column.type} is currently not supported`;
  }
  return read(buffer, column, database);
}

// node_modules/mdb-reader/lib/node/usage-map.js
function findMapPages(buffer, database) {
  switch (buffer[0]) {
    case 0:
      return findMapPages0(buffer);
    case 1:
      return findMapPages1(buffer, database);
    default:
      throw new Error("Unknown usage map type");
  }
}
function findMapPages0(buffer) {
  const pageStart = buffer.readUInt32LE(1);
  const bitmap = buffer.slice(5);
  return getPagesFromBitmap(bitmap, pageStart);
}
function findMapPages1(buffer, database) {
  const bitmapLength = (database.format.pageSize - 4) * 8;
  const mapCount = Math.floor((buffer.length - 1) / 4);
  const pages = [];
  for (let mapIndex = 0; mapIndex < mapCount; ++mapIndex) {
    const page = buffer.readUInt32LE(1 + mapIndex * 4);
    if (page === 0) {
      continue;
    }
    const pageBuffer = database.getPage(page);
    assertPageType(pageBuffer, PageType.PageUsageBitmaps);
    const bitmap = pageBuffer.slice(4);
    pages.push(...getPagesFromBitmap(bitmap, mapIndex * bitmapLength));
  }
  return pages;
}
function getPagesFromBitmap(bitmap, pageStart) {
  const pages = [];
  for (let i = 0; i < bitmap.length * 8; i++) {
    if (getBitmapValue(bitmap, i)) {
      pages.push(pageStart + i);
    }
  }
  return pages;
}

// node_modules/mdb-reader/lib/node/Table.js
var Table = class {
  #name;
  #database;
  #firstDefinitionPage;
  #definitionBuffer;
  #dataPages;
  /**
   * Number of rows.
   */
  #rowCount;
  /**
   * Number of columns.
   */
  #columnCount;
  #variableColumnCount;
  // #fixedColumnCount: number;
  // #logicalIndexCount: number;
  #realIndexCount;
  /**
   * @param name Table name. As this is stored in a MSysObjects, it has to be passed in
   * @param database
   * @param firstDefinitionPage The first page of the table definition referenced in the corresponding MSysObject
   */
  constructor(name, database, firstDefinitionPage) {
    this.#name = name;
    this.#database = database;
    this.#firstDefinitionPage = firstDefinitionPage;
    let nextDefinitionPage = this.#firstDefinitionPage;
    let buffer;
    while (nextDefinitionPage > 0) {
      const curBuffer = this.#database.getPage(nextDefinitionPage);
      assertPageType(curBuffer, PageType.TableDefinition);
      if (!buffer) {
        buffer = curBuffer;
      } else {
        buffer = Buffer.concat([buffer, curBuffer.slice(8)]);
      }
      nextDefinitionPage = curBuffer.readUInt32LE(4);
    }
    if (!buffer) {
      throw new Error("Could not find table definition page");
    }
    this.#definitionBuffer = buffer;
    this.#rowCount = this.#definitionBuffer.readUInt32LE(this.#database.format.tableDefinitionPage.rowCountOffset);
    this.#columnCount = this.#definitionBuffer.readUInt16LE(this.#database.format.tableDefinitionPage.columnCountOffset);
    this.#variableColumnCount = this.#definitionBuffer.readUInt16LE(this.#database.format.tableDefinitionPage.variableColumnCountOffset);
    this.#realIndexCount = this.#definitionBuffer.readInt32LE(this.#database.format.tableDefinitionPage.realIndexCountOffset);
    const usageMapBuffer = this.#database.findPageRow(this.#definitionBuffer.readUInt32LE(this.#database.format.tableDefinitionPage.usageMapOffset));
    this.#dataPages = findMapPages(usageMapBuffer, this.#database);
  }
  get name() {
    return this.#name;
  }
  get rowCount() {
    return this.#rowCount;
  }
  get columnCount() {
    return this.#columnCount;
  }
  /** [XGPY patch] 暴露原始 TDEF buffer，供上层解析索引/主键（mdb-reader 本身不解析索引）。 */
  get definitionBuffer() {
    return this.#definitionBuffer;
  }
  /** [XGPY patch] 暴露底层 Database（取原始页 / 解 LvProp 用）。 */
  get database() {
    return this.#database;
  }
  /**
   * Returns a column definition by its name.
   *
   * @param name Name of the column. Case sensitive.
   */
  getColumn(name) {
    const column = this.getColumns().find((c) => c.name === name);
    if (column === void 0) {
      throw new Error(`Could not find column with name ${name}`);
    }
    return column;
  }
  /**
   * Returns an ordered array of all column definitions.
   */
  getColumns() {
    const columnDefinitions = this.#getColumnDefinitions();
    columnDefinitions.sort((a, b) => a.index - b.index);
    return columnDefinitions.map(({ index, variableIndex, fixedIndex, ...rest }) => rest);
  }
  #getColumnDefinitions() {
    const columns = [];
    let curDefinitionPos = this.#database.format.tableDefinitionPage.realIndexStartOffset + this.#realIndexCount * this.#database.format.tableDefinitionPage.realIndexEntrySize;
    let namesCursorPos = curDefinitionPos + this.#columnCount * this.#database.format.tableDefinitionPage.columnsDefinition.entrySize;
    for (let i = 0; i < this.#columnCount; ++i) {
      const columnBuffer = this.#definitionBuffer.slice(curDefinitionPos, curDefinitionPos + this.#database.format.tableDefinitionPage.columnsDefinition.entrySize);
      const type = getColumnType(this.#definitionBuffer.readUInt8(curDefinitionPos + this.#database.format.tableDefinitionPage.columnsDefinition.typeOffset));
      const nameLength = this.#definitionBuffer.readUIntLE(namesCursorPos, this.#database.format.tableDefinitionPage.columnNames.nameLengthSize);
      namesCursorPos += this.#database.format.tableDefinitionPage.columnNames.nameLengthSize;
      const name = uncompressText(this.#definitionBuffer.slice(namesCursorPos, namesCursorPos + nameLength), this.#database.format);
      namesCursorPos += nameLength;
      const column = {
        name,
        type,
        index: columnBuffer.readUInt8(this.#database.format.tableDefinitionPage.columnsDefinition.indexOffset),
        variableIndex: columnBuffer.readUInt8(this.#database.format.tableDefinitionPage.columnsDefinition.variableIndexOffset),
        size: type === ColumnTypes.Boolean ? 0 : columnBuffer.readUInt16LE(this.#database.format.tableDefinitionPage.columnsDefinition.sizeOffset),
        fixedIndex: columnBuffer.readUInt16LE(this.#database.format.tableDefinitionPage.columnsDefinition.fixedIndexOffset),
        ...parseColumnFlags(columnBuffer.readUInt8(this.#database.format.tableDefinitionPage.columnsDefinition.flagsOffset))
      };
      if (type === ColumnTypes.Numeric) {
        column.precision = columnBuffer.readUInt8(11);
        column.scale = columnBuffer.readUInt8(12);
      }
      if (type === ColumnTypes.Complex) {
        const complexTypeIdOffset = this.#database.format.tableDefinitionPage.columnsDefinition.complexTypeIdOffset;
        if (complexTypeIdOffset !== void 0) {
          column.complex = {
            typeId: columnBuffer.readInt32LE(complexTypeIdOffset),
            tableDefinitionPage: this.#firstDefinitionPage
          };
        } else {
          throw new Error("Complex columns are not supported");
        }
      }
      columns.push(column);
      curDefinitionPos += this.#database.format.tableDefinitionPage.columnsDefinition.entrySize;
    }
    return columns;
  }
  /**
   * Returns an ordered array of all column names.
   */
  getColumnNames() {
    return this.getColumns().map((column) => column.name);
  }
  /**
   * Returns data from the table.
   *
   * @param columns Columns to be returned. Defaults to all columns.
   * @param rowOffset Index of the first row to be returned. 0-based. Defaults to 0.
   * @param rowLimit Maximum number of rows to be returned. Defaults to Infinity.
   */
  getData(options = {}) {
    const columnDefinitions = this.#getColumnDefinitions();
    const data = [];
    const columns = columnDefinitions.filter((c) => options.columns === void 0 || options.columns.includes(c.name));
    let rowsToSkip = options?.rowOffset ?? 0;
    let rowsToRead = options?.rowLimit ?? Infinity;
    for (const dataPage of this.#dataPages) {
      if (rowsToRead <= 0) {
        break;
      }
      const pageBuffer = this.#getDataPage(dataPage);
      const recordOffsets = this.#getRecordOffsets(pageBuffer);
      if (recordOffsets.length <= rowsToSkip) {
        rowsToSkip -= recordOffsets.length;
        continue;
      }
      const recordOffsetsToLoad = recordOffsets.slice(rowsToSkip, rowsToSkip + rowsToRead);
      const recordsOnPage = this.#getDataFromPage(pageBuffer, recordOffsetsToLoad, columns);
      data.push(...recordsOnPage);
      rowsToRead -= recordsOnPage.length;
      rowsToSkip = 0;
    }
    return data;
  }
  #getDataPage(page) {
    const pageBuffer = this.#database.getPage(page);
    assertPageType(pageBuffer, PageType.DataPage);
    if (pageBuffer.readUInt32LE(4) !== this.#firstDefinitionPage) {
      throw new Error(`Data page ${page} does not belong to table ${this.#name}`);
    }
    return pageBuffer;
  }
  #getRecordOffsets(pageBuffer) {
    const recordCount = pageBuffer.readUInt16LE(this.#database.format.dataPage.recordCountOffset);
    const recordOffsets = [];
    for (let record = 0; record < recordCount; ++record) {
      const offsetMask = 8191;
      let recordStart = pageBuffer.readUInt16LE(this.#database.format.dataPage.record.countOffset + 2 + record * 2);
      if (recordStart & 16384) {
        continue;
      }
      recordStart &= offsetMask;
      const nextStart = record === 0 ? this.#database.format.pageSize : pageBuffer.readUInt16LE(this.#database.format.dataPage.record.countOffset + record * 2) & offsetMask;
      const recordLength = nextStart - recordStart;
      const recordEnd = recordStart + recordLength - 1;
      recordOffsets.push([recordStart, recordEnd]);
    }
    return recordOffsets;
  }
  #getDataFromPage(pageBuffer, recordOffsets, columns) {
    const lastColumnIndex = Math.max(...columns.map((c) => c.index), 0);
    const data = [];
    for (const [recordStart, recordEnd] of recordOffsets) {
      const rowColumnCount = pageBuffer.readUIntLE(recordStart, this.#database.format.dataPage.record.columnCountSize);
      const bitmaskSize = roundToFullByte(rowColumnCount);
      let rowVariableColumnCount = 0;
      const variableColumnOffsets = [];
      if (this.#variableColumnCount > 0) {
        switch (this.#database.format.dataPage.record.variableColumnCountSize) {
          case 1: {
            rowVariableColumnCount = pageBuffer.readUInt8(recordEnd - bitmaskSize);
            const recordLength = recordEnd - recordStart + 1;
            let jumpCount = Math.floor((recordLength - 1) / 256);
            const columnPointer = recordEnd - bitmaskSize - jumpCount - 1;
            if ((columnPointer - recordStart - rowVariableColumnCount) / 256 < jumpCount) {
              --jumpCount;
            }
            let jumpsUsed = 0;
            for (let i = 0; i < rowVariableColumnCount + 1; ++i) {
              while (jumpsUsed < jumpCount && i === pageBuffer.readUInt8(recordEnd - bitmaskSize - jumpsUsed - 1)) {
                ++jumpsUsed;
              }
              variableColumnOffsets.push(pageBuffer.readUInt8(columnPointer - i) + jumpsUsed * 256);
            }
            break;
          }
          case 2: {
            rowVariableColumnCount = pageBuffer.readUInt16LE(recordEnd - bitmaskSize - 1);
            for (let i = 0; i < rowVariableColumnCount + 1; ++i) {
              variableColumnOffsets.push(pageBuffer.readUInt16LE(recordEnd - bitmaskSize - 3 - i * 2));
            }
            break;
          }
        }
      }
      const rowFixedColumnCount = rowColumnCount - rowVariableColumnCount;
      const nullMask = pageBuffer.slice(recordEnd - bitmaskSize + 1, recordEnd - bitmaskSize + 1 + roundToFullByte(lastColumnIndex + 1));
      let fixedColumnsFound = 0;
      const recordValues = {};
      for (const column of [...columns].sort((a, b) => a.index - b.index)) {
        let value = void 0;
        let start;
        let size;
        if (!getBitmapValue(nullMask, column.index)) {
          value = null;
        }
        if (column.fixedLength && fixedColumnsFound < rowFixedColumnCount) {
          const colStart = column.fixedIndex + this.#database.format.dataPage.record.columnCountSize;
          start = recordStart + colStart;
          size = column.size;
          ++fixedColumnsFound;
        } else if (!column.fixedLength && column.variableIndex < rowVariableColumnCount) {
          const colStart = variableColumnOffsets[column.variableIndex];
          start = recordStart + colStart;
          size = variableColumnOffsets[column.variableIndex + 1] - colStart;
        } else {
          start = 0;
          value = null;
          size = 0;
        }
        if (column.type === ColumnTypes.Boolean) {
          value = value === void 0;
        } else if (value !== null) {
          value = readFieldValue(pageBuffer.slice(start, start + size), column, this.#database);
        }
        recordValues[column.name] = value;
      }
      data.push(recordValues);
    }
    return data;
  }
};

// node_modules/mdb-reader/lib/node/MDBReader.js
var MDBReader = class {
  #buffer;
  #sysObjects;
  #database;
  /**
   * @param buffer Buffer of the database.
   */
  constructor(buffer, { password } = {}) {
    this.#buffer = buffer;
    assertPageType(this.#buffer, PageType.DatabaseDefinitionPage);
    this.#database = new Database(this.#buffer, password ?? "");
    const mSysObjectsTable = getMSysObjectsTable(this.#database).getData({
      columns: ["Id", "Name", "Type", "Flags"]
    });
    this.#sysObjects = mSysObjectsTable.map((mSysObject) => {
      const objectType = mSysObject.Type & 127;
      return {
        objectName: mSysObject.Name,
        objectType: isSysObjectType(objectType) ? objectType : null,
        tablePage: maskTableId(mSysObject.Id),
        flags: mSysObject.Flags
      };
    });
  }
  /**
   * Date when the database was created
   */
  getCreationDate() {
    return this.#database.getCreationDate();
  }
  /**
   * Database password
   */
  getPassword() {
    return this.#database.getPassword();
  }
  /**
   * Default sort order
   */
  getDefaultSortOrder() {
    return this.#database.getDefaultSortOrder();
  }
  /**
   * Returns an array of table names.
   *
   * @param normalTables Includes user tables. Default true.
   * @param systemTables Includes system tables. Default false.
   * @param linkedTables Includes linked tables. Default false.
   */
  getTableNames({ normalTables = true, systemTables = false, linkedTables = false } = {}) {
    const filteredSysObjects = [];
    for (const sysObject of this.#sysObjects) {
      if (sysObject.objectType === SysObjectTypes.Table) {
        if (!isSystemObject(sysObject)) {
          if (normalTables) {
            filteredSysObjects.push(sysObject);
          }
        } else if (systemTables) {
          filteredSysObjects.push(sysObject);
        }
      } else if (sysObject.objectType === SysObjectTypes.LinkedTable && linkedTables) {
        filteredSysObjects.push(sysObject);
      }
    }
    return filteredSysObjects.map((o) => o.objectName);
  }
  /**
   * Returns a table by its name.
   *
   * @param name Name of the table. Case sensitive.
   */
  getTable(name) {
    const sysObject = this.#sysObjects.filter((o) => o.objectType === SysObjectTypes.Table).find((o) => o.objectName === name);
    if (!sysObject) {
      throw new Error(`Could not find table with name ${name}`);
    }
    return new Table(name, this.#database, sysObject.tablePage);
  }
};

// entry.mjs
var entry_default = MDBReader;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Database,
  Table
});
