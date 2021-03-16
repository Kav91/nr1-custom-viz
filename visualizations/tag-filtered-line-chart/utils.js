import { ngql } from "nr1";

export const deriveGuids = (nrqlData) => {
  return nrqlData.chart
    .map(
      (item) =>
        item.metadata.groups.find(
          (v) => v.name === "entityGuid" && v.type === "facet"
        ).value
    )
    .filter((guid) => guid !== "Other");
};

export const checkErrors = (config) => {
  const { accountId, tagBridges } = config;
  const query = config.query || "";

  let errors = [];
  if (!accountId) errors.push("Required: Account ID");

  return [
    ...errors,
    ...checkQuery(query),
    ...checkTagBridges(tagBridges, query),
  ];
};

export const checkQuery = (query) => {
  const errors = [];
  const lowerQuery = query.toLowerCase();
  if (!query) {
    errors.push(
      "Required: Query eg. FROM SystemSample SELECT count(*) TIMESERIES FACET entityName, entityGuid LIMIT 100"
    );
  } else {
    if (!lowerQuery.includes("timeseries")) {
      errors.push("Required: TIMESERIES for query");
    }
    if (!lowerQuery.includes("facet") && query.includes("entityGuid")) {
      errors.push("Required: FACET with entityGuid required");
    }
  }
  return errors;
};

export const checkTagBridges = (tagBridges, query) => {
  const errors = [];
  tagBridges.forEach((bridge, index) => {
    const { entityTag, eventAttribute } = bridge;
    if ((entityTag && !eventAttribute) || (!entityTag && eventAttribute)) {
      errors.push(`Match ${index + 1}: Missing pair`);
    }
    if (eventAttribute && !query.includes(eventAttribute)) {
      errors.push(
        `Match ${
          index + 1
        }: Event attribute "${eventAttribute}" must appear in your query`
      );
    }
  });
  return errors;
};

// chunking for batching nerdgraph calls
export const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

export const entityQuery = (guids) => ngql`{
    actor {
      entities(guids: [${guids}]) {
        account {
          id
          name
        }
        guid
        tags {
          key
          values
        }
        entityType
        type
      }
    }
  }`;

export const removeEntityGuids = (data) => {
  data.chart.forEach((item, index) => {
    const guid = item.metadata.groups.find(
      (v) => v.name === "entityGuid" && v.type === "facet"
    ).value;
    data.chart[index].metadata.name = data.chart[index].metadata.name
      .replace(`, ${guid}`, "")
      .replace(guid, "");
  });
  return data;
};

export const processTagBridges = (data, tagBridges, state, workingState) => {
  // custom viz will still send an undefined set, so we need to filter this out
  const bridges = tagBridges.filter((t) =>
    !t.entityTag && !t.eventAttribute ? false : true
  );

  if (bridges.length > 0) {
    data.chart = data.chart.filter((item) => {
      let passed = false;

      const guid = item.metadata.groups.find(
        (v) => v.name === "entityGuid" && v.type === "facet"
      ).value;

      const guidData = state[guid] || workingState[guid];

      if (guidData) {
        const { tags } = guidData;

        let passedBridges = 0;

        bridges.forEach((bridge) => {
          const foundKey = tags.find(
            (entityTag) => entityTag.key === bridge.entityTag
          );

          const foundNrqlValue = item.metadata.groups.find(
            (v) => v.name === bridge.eventAttribute && v.type === "facet"
          ).value;

          if (foundKey && foundNrqlValue) {
            if (foundKey.values.find((v) => v === foundNrqlValue)) {
              passedBridges++;
            }
          }
        });

        if (passedBridges === bridges.length) passed = true;
      }

      return passed;
    });

    return data;
  } else {
    return data;
  }
};

export const addFacetTags = (data, tagFacets, state, workingState) => {
  if (!tagFacets) return data;

  const facetTags = tagFacets.filter((t) => t.tag);

  if (facetTags.length > 0) {
    data.chart.forEach((item, index) => {
      const guid = item.metadata.groups.find(
        (v) => v.name === "entityGuid" && v.type === "facet"
      ).value;

      const guidData = state[guid] || workingState[guid];

      if (guidData) {
        const { tags } = guidData;

        facetTags.forEach((t) => {
          let newFacetValue = "unknown";

          const foundKey = tags.find((entityTag) => entityTag.key === t.tag);
          if (foundKey) {
            if (foundKey.values.length === 1)
              newFacetValue = foundKey.values[0];
            if (foundKey.values.length > 1)
              newFacetValue = `[${foundKey.values.join(",")}]`;
          }

          data.chart[index].metadata.name += `, ${newFacetValue}`;
        });
      }
    });

    return data;
  } else {
    return data;
  }
};

export const processRequiredTags = (
  requiredTags,
  data,
  state,
  workingState
) => {
  // custom viz will still send an undefined set, so we need to filter this out
  const reqTags = requiredTags.filter((t) =>
    !t.tag || (!t.tag && !t.value) ? false : true
  );

  if (reqTags.length > 0) {
    data.chart = data.chart.filter((item) => {
      let passed = false;

      const guid = item.metadata.groups.find(
        (v) => v.name === "entityGuid" && v.type === "facet"
      ).value;

      const guidData = state[guid] || workingState[guid];

      if (guidData) {
        const { tags } = guidData;

        let passedChecks = 0;

        reqTags.forEach((t) => {
          const foundKey = tags.find((entityTag) => entityTag.key === t.tag);
          if (foundKey) {
            if (!t.value && foundKey) {
              passedChecks++;
            } else {
              try {
                const valueRegex = new RegExp(t.value);
                const foundValue = foundKey.values.find((v) =>
                  valueRegex.test(v)
                );
                if (foundValue) passedChecks++;
              } catch (e) {
                console.log("bad regex", e);
              }
            }
          }
        });

        if (passedChecks === reqTags.length) passed = true;
      }

      return passed;
    });

    return data;
  } else {
    return data;
  }
};
