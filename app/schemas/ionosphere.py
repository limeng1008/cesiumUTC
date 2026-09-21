"""Explicit grid and binary transport contract for electron density volumes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.services.ionosphere_parameters import ParameterId, get_parameter

VolumeResolution = Literal["standard", "fine"]
VolumeSource = Literal["mock", "sami3"]


class ValidDomain(BaseModel):
    model_config = ConfigDict(frozen=True, allow_inf_nan=False)
    latitudeMin: float
    latitudeMax: float
    altitudeMin: float
    altitudeMax: float


class GridAxis(BaseModel):
    model_config = ConfigDict(frozen=True, allow_inf_nan=False)

    min: float
    max: float
    count: int = Field(gt=0)
    step: float = Field(gt=0)


class VolumeMetadata(BaseModel):
    model_config = ConfigDict(frozen=True, allow_inf_nan=False)

    id: str
    parameter: ParameterId = "Ne"
    parameterName: str = "电子密度"
    unit: Literal["m^-3", "K"] = "m^-3"
    sourceVariable: str | None = None
    sourceUnit: str | None = None
    species: str | None = None
    defaultNormalization: Literal["log", "linear"] = "log"
    longitude: GridAxis
    latitude: GridAxis
    altitude: GridAxis
    minValue: float = Field(ge=0)
    maxValue: float = Field(ge=0)
    sampling: Literal["cell-center"] = "cell-center"
    altitudeUnit: Literal["km"] = "km"
    dtype: Literal["float32"] = "float32"
    byteOrder: Literal["little"] = "little"
    order: Literal["zyx"] = "zyx"
    source: Literal["deterministic-mock", "sami3-model"] = "deterministic-mock"
    sourceName: str | None = None
    timestamp: str | None = None
    sourceFile: str | None = None
    sourceSha256: str | None = None
    sourceUrl: str | None = None
    noDataValue: float | None = None
    validDomain: ValidDomain | None = None
    byteLength: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_parameter(self):
        field = get_parameter(self.parameter)
        if self.unit != field.unit or self.defaultNormalization != field.normalization:
            raise ValueError("参数、单位与默认归一化方式不匹配")
        if self.species != field.species:
            raise ValueError("参数与离子物种不匹配")
        if self.sourceVariable is not None and self.sourceVariable not in field.aliases:
            raise ValueError("参数与来源变量不匹配")
        if self.sourceUnit is not None:
            field.conversion(self.sourceUnit)
        if self.parameter != "Ne" and (self.sourceVariable is None or self.sourceUnit is None):
            raise ValueError("非 Ne 参数必须声明来源变量及单位")
        if self.maxValue < self.minValue or (field.unit == "K" and self.minValue <= 0):
            raise ValueError("参数数值范围无效")
        return self


class VolumeMetadataResponse(BaseModel):
    code: int = 200
    msg: str = "OK"
    data: VolumeMetadata
