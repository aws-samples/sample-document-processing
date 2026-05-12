from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SsmParams(BaseModel):
    chunk_size: str = "5"
    pages_per_chunk: str = "10"


class SupervisorInput(BaseModel):
    documentId: str = ""
    pdfS3Path: str
    customerName: str
    userName: str
    customFields: list[dict[str, Any]]
    lookups: dict[str, Any] = Field(default_factory=dict)
    ssmParams: SsmParams = Field(default_factory=SsmParams)
    outputSchema: dict[str, Any] = Field(default_factory=dict)
    schemaType: str = "invoice"
    lookupNames: list[str] = Field(default_factory=list)


class SupervisorOutput(BaseModel):
    documentId: str
    customerName: str
    pdfS3Path: str
    outputS3Path: str
    errors: list[str] = Field(default_factory=list)


class ChunkInfo(BaseModel):
    chunkId: str
    startPage: int
    endPage: int
    s3Path: str


class ChunkingOutput(BaseModel):
    chunks: list[ChunkInfo]


class ExtractionOutput(BaseModel):
    chunkId: str
    extractedData: dict[str, Any]
    tempJsonS3Path: str


class MappingOutput(BaseModel):
    mappedJson: dict[str, Any]


class ValidationOutput(BaseModel):
    validatedJson: dict[str, Any]
    issues: list[str] = Field(default_factory=list)
    isValid: bool
