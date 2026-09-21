"""Controlled scalar fields: species are identified only by explicit variable names."""

from dataclasses import dataclass
import re
from typing import Literal

ParameterId = Literal["Ne", "Te", "Ti", "Ni_O+", "Ni_H+", "Ni_He+", "Ni_N+", "Ni_NO+", "Ni_O2+", "Ni_N2+"]


@dataclass(frozen=True)
class Parameter:
    id: str
    name: str
    unit: str
    aliases: tuple[str, ...]
    species: str | None = None

    @property
    def normalization(self):
        return "linear" if self.unit == "K" else "log"

    def conversion(self, source_unit):
        unit = source_unit.strip().lower().replace(" ", "").replace("**", "^")
        if self.unit == "K" and unit in ("k", "kelvin"):
            return 1
        if self.unit == "m^-3":
            if unit in ("cm-3", "cm^-3", "1/cm3", "cm⁻³"):
                return 1e6
            if unit in ("m-3", "m^-3", "1/m3", "m⁻³"):
                return 1
        raise ValueError(f"不支持的{self.name}单位：{source_unit or '未声明'}")


PARAMETERS = {
    p.id: p
    for p in (
        Parameter("Ne", "电子密度", "m^-3", ("dene0", "Ne", "ne")),
        Parameter("Te", "电子温度", "K", ("te", "te0", "Te")),
        Parameter("Ti", "离子温度", "K", ("ti", "ti0", "Ti")),
        *(
            Parameter(f"Ni_{species}", f"{species} 离子密度", "m^-3", (f"n_{alias}plus", f"Ni_{species}"), species)
            for species, alias in (
                ("O+", "o"),
                ("H+", "h"),
                ("He+", "he"),
                ("N+", "n"),
                ("NO+", "no"),
                ("O2+", "o2"),
                ("N2+", "n2"),
            )
        ),
    )
}


def get_parameter(parameter: str) -> Parameter:
    if parameter not in PARAMETERS:
        raise ValueError(f"不支持的电离层参数：{parameter}")
    return PARAMETERS[parameter]


def validate_species_declaration(variable, field: Parameter):
    """Use source declarations only to reject conflicts, never to infer aliases."""
    expected = field.species or ("electron" if field.id in ("Ne", "Te") else None)
    canonical = {"o+": "O+", "h+": "H+", "he+": "He+", "n+": "N+", "no+": "NO+", "o2+": "O2+", "n2+": "N2+"}
    names = (
        ("molecular oxygen", "o2+"),
        ("molecular nitrogen", "n2+"),
        ("nitric oxide", "no+"),
        ("oxygen", "o+"),
        ("hydrogen", "h+"),
        ("helium", "he+"),
        ("nitrogen", "n+"),
        ("protons?", "h+"),
    )
    generic_ions = {"ion", "ions", "all", "bulk", "total", "all ions", "bulk ions", "ion mixture"}
    for attribute in ("species", "ion_species", "long_name", "standard_name"):
        value = str(getattr(variable, attribute, "")).strip()
        if not value:
            continue
        text = value.lower().translate(str.maketrans({"⁺": "+", "₂": "2", "⁻": "-"})).replace("_", " ")
        if re.search(r"\bneutral\b", text):
            raise ValueError(f"{attribute} 声明中性物种，与电离层带电参数不匹配：{value}")
        if expected == "electron" and re.search(r"\bions?\s+(?:number\s+)?(?:temperature|density)\b", text):
            raise ValueError(f"{attribute} 声明离子参数，与{field.name}不匹配：{value}")
        for name, symbol in names:
            text = re.sub(r"\b" + name + r"\b", symbol, text)
        tokens = re.findall(r"(?<![a-z0-9])([a-z]{1,2}\d*\s*\++)", text)
        declared = {canonical.get(token.replace(" ", ""), "unsupported") for token in tokens}
        if re.search(r"\belectrons?\b|(?<![a-z0-9])e\s*-", text):
            declared.add("electron")
        if attribute in ("species", "ion_species") and not declared:
            if field.id == "Ti" and text in generic_ions:
                continue
            raise ValueError(f"不支持或不明确的 {attribute} 物种声明：{value}")
        if declared and declared != {expected}:
            raise ValueError(f"{attribute} 物种声明与{field.name}不匹配；不将特定物种温度视为通用 Ti：{value}")


def inspect_parameters(source) -> list[dict]:
    entries = []
    for field in PARAMETERS.values():
        aliases = [name for name in field.aliases if name in source.variables]
        for name in aliases:
            variable = source[name]
            entry = dict(
                parameter=field.id,
                parameterName=field.name,
                sourceVariable=name,
                sourceUnit=str(getattr(variable, "units", "")),
                unit=field.unit,
                dimensions=list(variable.dimensions),
                shape=list(variable.shape),
                available=True,
            )
            if field.species:
                entry["species"] = field.species
            try:
                if len(aliases) > 1:
                    raise ValueError("同一参数存在多个别名变量，无法唯一选择：" + ", ".join(aliases))
                if variable.dimensions != ("nt", "nlat", "nlon", "nalt"):
                    raise ValueError("仅支持 nt,nlat,nlon,nalt 四维标量，不支持额外物种维度")
                if getattr(variable.dtype, "kind", None) not in ("f", "i", "u"):
                    raise ValueError("参数变量必须使用实数数值类型，不支持字符串或复合类型")
                field.conversion(entry["sourceUnit"])
                validate_species_declaration(variable, field)
            except ValueError as error:
                entry.update(available=False, reason=str(error))
            entries.append(entry)
    known = {alias for field in PARAMETERS.values() for alias in field.aliases}
    for name, variable in source.variables.items():
        if (
            name not in known
            and name not in ("time", "lon", "lat", "alt")
            and (len(variable.dimensions) >= 4 or name.lower().startswith(("deni", "n_", "te", "ti")))
        ):
            entries.append(
                dict(
                    parameter=name,
                    parameterName="未支持变量",
                    sourceVariable=name,
                    sourceUnit=str(getattr(variable, "units", "")),
                    unit="",
                    dimensions=list(variable.dimensions),
                    shape=list(variable.shape),
                    available=False,
                    reason="变量未在参数注册表中；不自动推断物种编号或物理含义",
                )
            )
    return entries


def select_parameter(source, parameter: str):
    field = get_parameter(parameter)
    entries = [entry for entry in inspect_parameters(source) if entry["parameter"] == parameter]
    if not entries:
        raise ValueError(f"文件缺少{field.name}变量")
    if len(entries) != 1 or not entries[0]["available"]:
        raise ValueError(entries[0].get("reason", "参数别名冲突"))
    return field, entries[0]
