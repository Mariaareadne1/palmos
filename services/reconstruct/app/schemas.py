"""Pydantic models mirroring apps/web/src/types/scene.ts — field-for-field,
same names, camelCase preserved (SPEC §4). The scene graph is the single
contract between this service and the editor."""

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field


class Transform(BaseModel):
    x: float
    y: float
    scaleX: float
    scaleY: float
    rotation: float


class BaseLayer(BaseModel):
    id: str
    name: str
    transform: Transform
    opacity: float = Field(ge=0, le=1)
    visible: bool
    locked: bool


class PathLayer(BaseLayer):
    type: Literal["path"]
    d: str
    fill: Optional[str]
    stroke: Optional[str]
    strokeWidth: float


class TextLayer(BaseLayer):
    type: Literal["text"]
    text: str
    fontFamily: str
    fontSize: float
    fontWeight: int
    fill: str
    align: Literal["left", "center", "right"]


class ImageLayer(BaseLayer):
    type: Literal["image"]
    src: str
    width: float
    height: float


class GroupLayer(BaseLayer):
    type: Literal["group"]
    children: list["Layer"]


Layer = Union[PathLayer, TextLayer, ImageLayer, GroupLayer]

GroupLayer.model_rebuild()


class ModRouting(BaseModel):
    id: str
    layerId: str
    target: Literal["x", "y", "scale", "rotation", "opacity", "hue", "blur"]
    source: Literal["rms", "low", "mid", "high", "onset"]
    amount: float = Field(ge=-1, le=1)
    smoothing: float = Field(ge=0, le=1)
    invert: bool


class SceneGraph(BaseModel):
    id: str
    name: str
    width: float
    height: float
    background: str
    layers: list[Layer]
    routings: list[ModRouting]
    palette: list[str]
    version: Literal[1]


# ---- job envelope (SPEC §5 step 6 contract) ----


class JobCreated(BaseModel):
    job_id: str


class JobState(BaseModel):
    status: Literal["processing", "done", "error"]
    progress: float = Field(ge=0, le=1)
    stage: Optional[Literal["segmenting", "vectorizing", "assembling"]] = None
    scene: Optional[SceneGraph] = None
    engine: Optional[Literal["sam", "cv"]] = None
    error: Optional[str] = None
