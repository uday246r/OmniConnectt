import { httpClient } from "./httpClient";
import type { DocumentDefinition, DocumentDefinitionInput } from "../types/domain";

export const documentDefinitionApi = {
  async list(productTypeId?: string, signal?: AbortSignal): Promise<DocumentDefinition[]> {
    const { data } = await httpClient.get("/document-definitions", { params: { productTypeId }, signal });
    return data;
  },
  async create(input: DocumentDefinitionInput): Promise<DocumentDefinition> {
    const { data } = await httpClient.post("/document-definitions", input);
    return data;
  },
  async update(id: string, input: DocumentDefinitionInput): Promise<DocumentDefinition> {
    const { data } = await httpClient.put(`/document-definitions/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/document-definitions/${id}`);
  },
};
