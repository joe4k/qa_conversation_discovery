/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk
var DiscoveryV1 = require('watson-developer-cloud/discovery/v1'); // watson sdk

var app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Create the service wrapper for Conversation and Discovery
var conversation = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  //'username': process.env.CONVERSATION_USERNAME,
  //'password': process.env.CONVERSATION_PASSWORD,
  'version_date': Conversation.VERSION_DATE_2017_05_26
});

var discovery = new DiscoveryV1({
  username: process.env.DISCOVERY_USERNAME,
  password: process.env.DISCOVERY_PASSWORD,
  version: 'v1',
  version_date: '2017-11-07'
});


// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {},
    alternate_intents: true
  };


  var discovery_environment_id = process.env.DISCOVERY_ENVIRONMENT_ID || '<discovery-environment-id>';
  var discovery_collection_id = process.env.DISCOVERY_COLLECTION_ID || '<discovery-collection-id>';
  var discovery_query_fields = process.env.DISCOVERY_QUERY_FIELDS || '<discovery-query-fields>';
  if (!discovery_environment_id || !discovery_collection_id) {
    return res.json({
      'output': {
        'text': 'The app requires a DISCOVERY instance to be setup and documents ingest into a collection. Need to provide the environment id for the Discovery instance and the collection id which includes the corpus of documents.'
      }
    });
  }

  var discoveryCall = 'call_discovery';
  conversation.message(payload, function(err, data) {
     if (err) {
      return res.status(err.code || 500).json(err);
     }
     if (data.output && data.output.action) {
        var outaction = JSON.stringify(data.output.action);
	if(outaction.indexOf(discoveryCall) > -1) {

	  var user_input = data.input.text;
	  var qclass = data.context.qclass;
	  // One option is to pass user questions as a natural language query to Discovery
	  // The following payload shows how to do so

	  var discovery_payload = {
		environment_id: discovery_environment_id,
		collection_id: discovery_collection_id,
		natural_language_query: user_input,
		passages: true
	  };

/*
	  // Another option is to send the user input as a query using Discovery Query Language
	  // and search against a set of fields defined in the .env variable (DISCOVERY_QUERY_FIELDS)
	  // In the following payload, we leverage Discovery query language where we can query specific fields.
	  var queryFields = discovery_query_fields.split(',');
	  var queryText = "";
	  for (var j=0; j < queryFields.length; j++) {
	    queryText = queryText + queryFields[j] + ":" + user_input;
	    if (j < queryFields.length-1) {
	      queryText = queryText + ",";	
	    }
	  }	
	  // Add a filter field
	  var filterText = "qclass::" + qclass;
	  var discovery_payload = {
		environment_id: discovery_environment_id,
                collection_id: discovery_collection_id,
                query: queryText,
		passages: false,
		filter: filterText
          };
*/
	  discovery.query(discovery_payload, function(error, discovery_response) {
	    if(error) {
	      return res.status(error.code || 500).json(error);
	    }

	   var resp = data;
	   // return a maximum of 3 responses from Discovery
	   // In the following option we return the top 3 documents from Discovery

/*
	   var numResults = discovery_response.results.length;
	   var nResponses = 0;
	   if (numResults > 3) {
	     nResponses = 3;
	   } else {
	     nResponses = numResults;
	   }
	   resp.output.text = "";
	   for (var i = 0; i < nResponses; i++) {
	     resp.output.text = resp.output.text + discovery_response.results[i].text;
	   }

*/
	   // In the following option, we return top 3 passages instead of complete documents
	   var numResults = discovery_response.passages.length;
	   var nResponses = 0;
	   if (numResults > 3) {
	     nResponses = 3;
	   } else {
	     nResponses = numResults;
	   }
	   resp.output.text = "";
	   for (var i = 0; i < nResponses; i++) {
	     resp.output.text = resp.output.text + discovery_response.passages[i].passage_text + "<br></br><br></br>";
	   }


	   return res.json(resp);
	  });
	} else {
          console.log('not calling discovery');
	  return res.json(data);
	}
     } else {
       // If discovery is not called, return the conversation response
       console.log('not calling discovery');
       return res.json(data);
     }
  });

});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

module.exports = app;
