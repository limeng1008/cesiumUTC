"""Managed datasets reference disk artifacts; individual grid cells are not DB rows."""

import uuid

from tortoise import fields, models

from .base import TimestampMixin


class IonosphereDataset(models.Model, TimestampMixin):
    id = fields.UUIDField(pk=True, default=uuid.uuid4)
    owner = fields.ForeignKeyField("models.User", related_name="ionosphere_datasets", on_delete=fields.RESTRICT)
    name = fields.CharField(max_length=255)
    original_name = fields.CharField(max_length=255)
    byte_size = fields.BigIntField()
    sha256 = fields.CharField(max_length=64, index=True)
    status = fields.CharField(max_length=20, default="inspecting", index=True)
    preview = fields.JSONField(null=True)
    error = fields.TextField(default="")

    class Meta:
        table = "ionosphere_dataset"


class IonosphereImport(models.Model, TimestampMixin):
    id = fields.UUIDField(pk=True, default=uuid.uuid4)
    dataset = fields.ForeignKeyField("models.IonosphereDataset", related_name="imports", on_delete=fields.RESTRICT)
    time_index = fields.IntField()
    parameter = fields.CharField(max_length=16, default="Ne")
    timestamp = fields.CharField(max_length=32)
    status = fields.CharField(max_length=20, default="queued", index=True)
    progress = fields.IntField(default=0)
    error = fields.TextField(default="")

    class Meta:
        table = "ionosphere_import"
        unique_together = (("dataset", "time_index", "parameter"),)
