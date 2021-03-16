import React from "react";

import {
  Card,
  CardBody,
  HeadingText,
  NrqlQuery,
  Spinner,
  AutoSizer,
  LineChart,
  NerdGraphQuery,
} from "nr1";
import {
  chunk,
  checkErrors,
  deriveGuids,
  entityQuery,
  processRequiredTags,
  addFacetTags,
  removeEntityGuids,
  processTagBridges,
} from "./utils";

const defaultInterval = 60;

export default class TagFilteredLineChart extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      init: false,
      rawData: [],
      chartData: [],
      nrqlError: null,
      errors: [],
      pollInterval: null,
      accountId: 0,
      query: "",
      tagBridges: [],
      requiredTags: [],
      tagFacets: [],
      showGuid: false,
      processingEntityData: false,
    };
  }

  componentDidUpdate() {
    this.handleData(this.props);
  }

  componentWillUnmount() {
    if (this.dataPoll) {
      clearInterval(this.dataPoll);
    }
  }

  handleData = (cfg) => {
    const {
      init,
      accountId,
      query,
      tagBridges,
      requiredTags,
      tagFacets,
      showGuid,
      pollInterval,
    } = this.state;
    if (
      accountId !== cfg.accountId ||
      query !== cfg.query ||
      JSON.stringify(tagBridges) !== JSON.stringify(cfg.tagBridges) ||
      JSON.stringify(requiredTags) !== JSON.stringify(cfg.requiredTags) ||
      JSON.stringify(tagFacets) !== JSON.stringify(cfg.tagFacets) ||
      showGuid !== cfg.showGuid ||
      pollInterval !== cfg.pollInterval
    ) {
      console.log(`Received update: ${new Date().toLocaleTimeString()}`);

      const errors = checkErrors(cfg);
      const stateUpdate = {
        errors,
        accountId: cfg.accountId,
        query: cfg.query,
        pollInterval: cfg.pollInterval,
        tagBridges: cfg.tagBridges,
        requiredTags: cfg.requiredTags,
        tagFacets: cfg.tagFacets,
        showGuid: cfg.showGuid,
        loading: errors.length === 0,
        nrqlError: null,
      };

      this.setState(stateUpdate, () => {
        if (stateUpdate.loading) {
          this.fetchData();
          clearInterval(this.dataPoll);
          this.dataPoll = setInterval(() => {
            console.log(`Fetching data: ${new Date().toLocaleTimeString()}`);
            this.fetchData();
          }, (cfg.pollInterval || defaultInterval) * 1000);
        }
      });
    }
  };

  fetchData = async () => {
    const { accountId, query } = this.state;
    const { data, error } = await NrqlQuery.query({ query, accountId });

    if (error) {
      this.setState({ nrqlError: error });
    } else {
      this.setState(
        {
          processingEntityData: true,
          nrqlError: null,
          rawData: data,
          loading: false,
        },
        async () => {
          const stateUpdate = { chartData: [], processingEntityData: false };

          // fetch entity data data
          const guids = deriveGuids(data);
          const guidsToFetch = guids.filter((guid) => !this.state[guid]);

          if (guidsToFetch.length > 0) {
            const guidChunks = chunk(guidsToFetch, 25);
            const guidPromises = guidChunks.map((chunk) => {
              return new Promise(async (resolve) => {
                const guids = `"${chunk.join(`","`)}"`;
                const result = await NerdGraphQuery.query({
                  query: entityQuery(guids),
                });
                resolve(result?.data?.actor?.entities || []);
              });
            });

            await Promise.all(guidPromises).then((chunks) => {
              chunks.forEach((chunk) => {
                chunk.forEach((entity) => {
                  stateUpdate[entity.guid] = entity;
                });
              });
            });
          }

          // process chart data with entity data
          const { requiredTags, tagFacets, showGuid, tagBridges } = this.state;
          let workingData = processRequiredTags(
            requiredTags,
            data,
            this.state,
            stateUpdate
          );
          workingData = addFacetTags(data, tagFacets, this.state, stateUpdate);
          workingData = processTagBridges(
            data,
            tagBridges,
            this.state,
            stateUpdate
          );

          if (!showGuid) {
            workingData = removeEntityGuids(data);
          }

          console.log(workingData);

          stateUpdate.chartData = workingData;
          this.setState(stateUpdate);
        }
      );
    }
  };

  processEntityData = (nrqlData) => {
    return new Promise((resolve) => {
      this.setState({ processingEntityData: true }, () => {
        resolve(nrqlData);
      });
    });
  };

  render() {
    const { loading, processingEntityData, errors, chartData } = this.state;
    // console.log(`Rendering: ${new Date().toLocaleTimeString()}`);

    if (errors.length > 0) {
      return EmptyState(errors);
    }

    if (loading || processingEntityData) {
      return <Spinner />;
    }

    return (
      <AutoSizer>
        {({ width, height }) => (
          <LineChart style={{ height, width }} data={chartData.chart} />
        )}
      </AutoSizer>
    );
  }
}

const EmptyState = (errors) => (
  <Card className="EmptyState">
    <CardBody className="EmptyState-cardBody">
      <HeadingText
        spacingType={[HeadingText.SPACING_TYPE.LARGE]}
        type={HeadingText.TYPE.HEADING_3}
      >
        This custom visualization allows you to filter your line chart with
        entity tags. Initial load may take time.
      </HeadingText>
      <br />
      <HeadingText
        spacingType={[HeadingText.SPACING_TYPE.LARGE]}
        type={HeadingText.TYPE.HEADING_3}
      >
        Please amend any errors and supply the base configuration...
      </HeadingText>
      <div>
        {errors.map((error, i) => {
          return (
            <HeadingText
              key={i}
              spacingType={[HeadingText.SPACING_TYPE.MEDIUM]}
              type={HeadingText.TYPE.HEADING_4}
            >
              {error}
            </HeadingText>
          );
        })}
      </div>

      <HeadingText
        spacingType={[HeadingText.SPACING_TYPE.LARGE]}
        type={HeadingText.TYPE.HEADING_5}
      >
        Author: Kav P.
      </HeadingText>
    </CardBody>
  </Card>
);

const ErrorState = (error, query) => (
  <Card className="ErrorState">
    <CardBody className="ErrorState-cardBody">
      <HeadingText
        className="ErrorState-headingText"
        spacingType={[HeadingText.SPACING_TYPE.LARGE]}
        type={HeadingText.TYPE.HEADING_3}
      >
        Oops! Something went wrong.
      </HeadingText>
      <HeadingText
        spacingType={[HeadingText.SPACING_TYPE.MEDIUM]}
        type={HeadingText.TYPE.HEADING_4}
      >
        {error}
      </HeadingText>
      {query && (
        <HeadingText
          spacingType={[HeadingText.SPACING_TYPE.MEDIUM]}
          type={HeadingText.TYPE.HEADING_4}
        >
          Query: {query}
        </HeadingText>
      )}
    </CardBody>
  </Card>
);
