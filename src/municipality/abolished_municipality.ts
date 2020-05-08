import chalk from "chalk";
import * as fs from "fs-extra";
import * as t from "io-ts";
import { Either, left, right } from "../../node_modules/fp-ts/lib/Either";
import {
  ABOLISHED_MUNICIPALITIES_FILEPATH,
  MUNICIPALITIES_CATASTALI_FILEPATH
} from "../config";
import {
  AbolishedMunicipality,
  AbolishedMunicipalityArray
} from "../types/AbolishedMunicipality";
import { ISerializableMunicipality } from "../types/ISerializableMunicipality";
import { logError } from "../utils/log_left_error";
import { parseCsvPromise } from "../utils/parse_csv_promise";
import { serializeMunicipalityToJson } from "./serialize_municipality";

const optionMunicipalitiesWithCatastale = {
  delimiter: ",",
  from_line: 1,
  skip_empty_lines: true,
  skip_lines_with_error: true,
  trim: true
};

/**
 * load all the codici catastali and create a mapping between the name of the municipality and the codice catastale
 */
const loadMunicipalityToCatastale = async (): Promise<
  Either<Error, Map<string, string>>
> => {
  // read raw data from csv
  try {
    const municipalityWithCatastaleRaw = fs
      .readFileSync(MUNICIPALITIES_CATASTALI_FILEPATH)
      .toString("utf8");

    // parse raw data
    const municipalitiesCatastaleRows = await parseCsvPromise(
      municipalityWithCatastaleRaw,
      optionMunicipalitiesWithCatastale
    );

    // transform raw data to: [municipalityName] : codiceCatastale
    return right(
      municipalitiesCatastaleRows.reduce((map: Map<string, string>, row) => {
        map.set(row[1].toLowerCase(), row[0]);
        return map;
      }, new Map<string, string>())
    );
  } catch (e) {
    return left(new Error(String(e)));
  }
};

const fromAbolishedMunicipalityToSerializableMunicipality = (
  abolishedMunicipality: t.TypeOf<typeof AbolishedMunicipality>,
  codiceCatastale: string
) => {
  return {
    codiceCatastale,
    municipality: {
      codiceProvincia: "",
      codiceRegione: "",
      denominazione: abolishedMunicipality.comune,
      denominazioneInItaliano: abolishedMunicipality.comune,
      denominazioneRegione: "",
      siglaProvincia: abolishedMunicipality.provincia
    }
  } as ISerializableMunicipality;
};

/**
 * load the abolished municipality and filter the municipality without catastal code
 * @param municipalityToCatastale: used to filter and remove the municipality without catastal code
 */
const loadAbolishedMunicipalities = (
  municipalityToCatastale: Map<string, string>
): Either<Error, ReadonlyArray<ISerializableMunicipality>> => {
  try {
    const removedMunicipalitiesRaw = fs
      .readFileSync(ABOLISHED_MUNICIPALITIES_FILEPATH)
      .toString("utf8");

    const items = AbolishedMunicipalityArray.decode(
      JSON.parse(removedMunicipalitiesRaw)
    );
    if (items.isLeft()) {
      throw items.value;
    }

    return right(
      items.reduce(
        [] as ReadonlyArray<ISerializableMunicipality>,
        (acc, val) => {
          return val
            .filter(m => municipalityToCatastale.has(m.comune.toLowerCase()))
            .map(mm =>
              fromAbolishedMunicipalityToSerializableMunicipality(
                mm,
                // we can use non-null assertion since here all items have a match into the map
                municipalityToCatastale.get(mm.comune.toLowerCase())!
              )
            );
        }
      )
    );
  } catch (ex) {
    return left(new Error(String(ex)));
  }
};

/**
 * This function export the data of the abolished municipalities, creating the data starting from two dataset:
 * :ABOLISHED_MUNICIPALITIES_FILEPATH: : a dataset of abolished municipalities
 * :MUNICIPALITIES_CATASTALI_FILEPATH: : a list of codici catastali associated to the municipality
 */
export const exportAbolishedMunicipality = async () => {
  console.log(
    chalk.gray("[1/2]"),
    "Start generation of abolished municipalites from local dataset"
  );
  const serializeMunicipalityPromise = (await loadMunicipalityToCatastale())
    .chain(municipalityToCatastale =>
      loadAbolishedMunicipalities(municipalityToCatastale)
    )
    .map(abolishedMunicipalities =>
      abolishedMunicipalities.map(municipality =>
        serializeMunicipalityToJson(municipality)
      )
    );

  if (serializeMunicipalityPromise.isLeft()) {
    logError(
      serializeMunicipalityPromise.value,
      "Error while exporting abolished municipalities"
    );
    return;
  }
  await Promise.all(serializeMunicipalityPromise.value);
  console.log(
    chalk.gray("[2/2]"),
    "Generation of abolished municipalites completed"
  );
};
