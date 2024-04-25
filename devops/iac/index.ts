import * as azure from "@pulumi/azure-native";

// Create an Azure Resource Group
const resourceGroup = new azure.resources.ResourceGroup("sander-rg");

// Create an Azure Storage Account in the Resource Group
const storageAccount = new azure.storage.StorageAccount("sandersa", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "Standard_LRS",
    },
    kind: "StorageV2",
});