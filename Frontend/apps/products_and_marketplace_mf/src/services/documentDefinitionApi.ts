import { httpClient } from './httpClient';
import { cleanParams } from './query';
import type { DocumentDefinition, DocumentDefinitionInput } from '../types/domain';

export const documentDefinitionApi = {
  /** Everything, or — with a sub-category — what applies to it plus what applies to every product. */
  async list(subCategoryId?: string, signal?: AbortSignal): Promise<DocumentDefinition[]> {
    const { data } = await httpClient.get('/document-definitions', { params: cleanParams({ subCategoryId }), signal });
    return data;
  },
  async create(input: DocumentDefinitionInput): Promise<DocumentDefinition> {
    const { data } = await httpClient.post('/document-definitions', input);
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
