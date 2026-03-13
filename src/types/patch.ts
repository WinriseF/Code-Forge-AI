export interface PatchOperation {
  originalBlock: string;
  modifiedBlock: string;
}

export interface FilePatch {
  filePath: string;
  operations: PatchOperation[];
}
