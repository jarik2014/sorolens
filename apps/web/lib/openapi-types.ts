/**
 * Shapes shared by the generated OpenAPI document and the playground.
 *
 * They follow OpenAPI 3 closely enough that a future spec loader can replace the
 * generated module without touching the playground.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description?: string;
  type?: "string" | "integer" | "number" | "boolean";
  default?: string;
}

export interface OpenAPIRequestBody {
  description?: string;
  example: string;
}

export interface OpenAPIOperation {
  operationId: string;
  summary: string;
  tags: string[];
  parameters: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
}

export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
}

export interface OpenAPIDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenAPIPathItem>;
}

/** A flattened, order-preserving view of the document's operations. */
export interface EndpointEntry {
  method: HttpMethod;
  path: string;
  operation: OpenAPIOperation;
}
